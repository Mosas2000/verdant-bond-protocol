import { Injectable, BadRequestException, GatewayTimeoutException } from '@nestjs/common';
import {
  rpc,
  TransactionBuilder,
  Keypair,
  nativeToScVal,
  scValToNative,
  Address,
  Contract,
  Account,
  BASE_FEE,
  xdr,
} from '@stellar/stellar-sdk';
import { StellarService } from './stellar.service';
import { NonceService } from '../common/services/nonce.service';

export interface ContractCallOptions {
  contractAddress: string;
  method: string;
  args: xdr.ScVal[];
  sourceSecretKey?: string;
}

export interface ContractCallResult {
  result: xdr.ScVal;
  transactionHash?: string;
  successful: boolean;
}

@Injectable()
export class ContractService {
  private sorobanRpc: rpc.Server;

  constructor(
    private readonly stellarService: StellarService,
    private readonly nonceService: NonceService,
  ) {
    this.sorobanRpc = new rpc.Server(
      process.env.SOROBAN_RPC_URL || 'http://localhost:8000/soroban/rpc',
      { allowHttp: true },
    );
  }

  async simulateCall(options: ContractCallOptions): Promise<xdr.ScVal> {
    try {
      const { contractAddress, method, args } = options;

      const keypair = options.sourceSecretKey
        ? Keypair.fromSecret(options.sourceSecretKey)
        : Keypair.random();

      const account = new Account(keypair.publicKey(), '0');
      const contract = new Contract(contractAddress);

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.stellarService.getNetworkPassphrase(),
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      const simulation = await this.sorobanRpc.simulateTransaction(transaction);

      if (rpc.Api.isSimulationError(simulation)) {
        throw new BadRequestException(
          `Contract simulation failed: ${this.describeSimulationError(simulation.error, simulation.events)}`,
        );
      }

      if (!simulation.result) {
        throw new BadRequestException(
          'Simulation returned no result',
        );
      }

      return simulation.result.retval;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to simulate contract call: ${error.message}`,
      );
    }
  }

  async sendTransaction(options: ContractCallOptions): Promise<ContractCallResult> {
    try {
      const { contractAddress, method, args, sourceSecretKey } = options;

      if (!sourceSecretKey) {
        throw new BadRequestException(
          'sourceSecretKey is required for state-changing transactions',
        );
      }

      const keypair = Keypair.fromSecret(sourceSecretKey);
      const contract = new Contract(contractAddress);

      const horizonAccount = await this.stellarService.getAccount(keypair.publicKey());
      const account = new Account(keypair.publicKey(), horizonAccount.sequence);

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.stellarService.getNetworkPassphrase(),
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      const simulation = await this.sorobanRpc.simulateTransaction(transaction);

      if (rpc.Api.isSimulationError(simulation)) {
        throw new BadRequestException(
          `Transaction simulation failed: ${this.describeSimulationError(simulation.error, simulation.events)}`,
        );
      }

      const preparedTransaction = await this.sorobanRpc.prepareTransaction(transaction);

      preparedTransaction.sign(keypair);

      const response = await this.sorobanRpc.sendTransaction(preparedTransaction);

      if (response.status === 'ERROR') {
        const errorMessage = this.decodeContractError(contractAddress, method);
        throw new BadRequestException(errorMessage);
      }

      const transactionResult = await this.pollTransaction(response.hash);
      if (transactionResult.status !== 'SUCCESS') {
        throw new BadRequestException(
          `Contract transaction failed with status ${transactionResult.status}: ${this.describeTransactionFailure(transactionResult)}`,
        );
      }

      return {
        result: transactionResult.returnValue ?? xdr.ScVal.scvVoid(),
        transactionHash: response.hash,
        successful: true,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to submit contract transaction: ${error.message}`,
      );
    }
  }

  private async pollTransaction(hash: string): Promise<any> {
    const intervalMs = this.positiveInteger(process.env.SOROBAN_POLL_INTERVAL_MS, 1_000);
    const timeoutMs = this.positiveInteger(process.env.SOROBAN_POLL_TIMEOUT_MS, 120_000);
    const deadline = Date.now() + timeoutMs;
    const retryable = new Set(['NOT_FOUND', 'PENDING', 'DUPLICATE', 'TRY_AGAIN_LATER']);

    while (Date.now() <= deadline) {
      const transaction = await this.sorobanRpc.getTransaction(hash) as any;
      if (!retryable.has(transaction.status)) {
        return transaction;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new GatewayTimeoutException(
      `Timed out waiting for Soroban transaction ${hash} after ${timeoutMs}ms`,
    );
  }

  private describeTransactionFailure(transaction: any): string {
    const diagnosticCode = this.extractContractErrorCode(
      transaction.errorResult,
      transaction.diagnosticEventsXdr,
    );
    if (diagnosticCode !== undefined) {
      return `${transaction.errorResult || 'contract execution failed'} (contract error code ${diagnosticCode})`;
    }
    const resultMeta = transaction.resultMetaXdr?.toString?.();
    return transaction.errorResult || resultMeta || 'no contract error details available';
  }

  private positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  encodeArg(value: unknown, type: string): xdr.ScVal {
    switch (type) {
      case 'address': {
        return Address.fromString(value as string).toScVal();
      }
      case 'i128': {
        return nativeToScVal(BigInt(value as number | bigint | string), { type: 'i128' });
      }
      case 'u64': {
        return nativeToScVal(BigInt(value as number | bigint | string), { type: 'u64' });
      }
      case 'bytes': {
        const buf = Buffer.from(value as string, 'hex');
        return xdr.ScVal.scvBytes(buf);
      }
      case 'symbol': {
        return nativeToScVal(value as string, { type: 'symbol' });
      }
      case 'string': {
        return nativeToScVal(value as string, { type: 'string' });
      }
      case 'bool': {
        return xdr.ScVal.scvBool(value as boolean);
      }
      case 'u32': {
        return xdr.ScVal.scvU32(value as number);
      }
      case 'i32': {
        return xdr.ScVal.scvI32(value as number);
      }
      case 'void': {
        return xdr.ScVal.scvVoid();
      }
      case 'vec': {
        return xdr.ScVal.scvVec(value as xdr.ScVal[]);
      }
      case 'map': {
        return xdr.ScVal.scvMap(value as xdr.ScMapEntry[]);
      }
      default:
        throw new BadRequestException(`Unsupported ScVal type: ${type}`);
    }
  }

  decodeArg(scval: xdr.ScVal): unknown {
    return scValToNative(scval);
  }

  async invokeContractMethod(
    contractAddress: string,
    method: string,
    callerSecretKey: string,
    args: unknown[],
    nonceAddress: string,
  ): Promise<ContractCallResult> {
    const encodedArgs = args.map((arg) => {
      if (arg instanceof xdr.ScVal) {
        return arg;
      }
      return nativeToScVal(arg);
    });

    return this.nonceService.withNonce(
      contractAddress,
      nonceAddress,
      async () => {
        const value = await this.simulateCall({
          contractAddress,
          method: 'get_nonce',
          args: [Address.fromString(nonceAddress).toScVal()],
        });
        return Number(scValToNative(value));
      },
      (nonce) => this.sendTransaction({
        contractAddress,
        method,
        args: [...encodedArgs, nativeToScVal(BigInt(nonce), { type: 'u64' })],
        sourceSecretKey: callerSecretKey,
      }),
    );
  }

  private describeSimulationError(
    error?: string,
    events?: xdr.DiagnosticEvent[],
  ): string {
    const code = this.extractContractErrorCode(error, events);
    if (code !== undefined) {
      return `${error || 'host error'} (contract error code ${code})`;
    }
    return error || 'unknown host error';
  }

  private decodeContractError(
    contractAddress: string,
    method: string,
  ): string {
    return `Contract error on ${contractAddress}.${method}`;
  }

  private extractContractErrorCode(
    error?: string,
    events?: xdr.DiagnosticEvent[],
  ): number | undefined {
    const match = error?.match(/Error\(Contract, #(\d+)\)/);
    if (match) {
      return Number(match[1]);
    }
    try {
      for (const diagnosticEvent of events ?? []) {
        const data = diagnosticEvent.event().body().v0().data();
        if (!data || data.switch().name !== 'scvError') {
          continue;
        }
        const scError = data.error();
        if (scError.switch().name !== 'sceContract') {
          continue;
        }
        return Number(scError.contractCode());
      }
    } catch {}
    return undefined;
  }

  getSorobanRpc(): rpc.Server {
    return this.sorobanRpc;
  }
}
