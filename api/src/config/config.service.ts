import { Injectable, OnModuleInit } from '@nestjs/common';

const REQUIRED_CONTRACT_ADDRESSES = [
  'BOND_ISSUER_ADDRESS',
  'COUPON_ENGINE_ADDRESS',
  'DEX_ROUTER_ADDRESS',
  'PROJECT_REGISTRY_ADDRESS',
  'ORACLE_CONSUMER_ADDRESS',
  'CREDIT_RETIREMENT_ADDRESS',
] as const;

type RequiredContractAddress = typeof REQUIRED_CONTRACT_ADDRESSES[number];

@Injectable()
export class ConfigService implements OnModuleInit {
  constructor() {}

  onModuleInit(): void {
    const missing = REQUIRED_CONTRACT_ADDRESSES.filter(
      (key) => !process.env[key] || process.env[key].trim() === '',
    );

    if (missing.length > 0) {
      throw new Error(
        `Missing required contract environment variables: ${missing.join(', ')}. ` +
        'Set these in your .env file before starting the application.',
      );
    }
  }

  getBondIssuerAddress(): string {
    return process.env.BOND_ISSUER_ADDRESS!;
  }

  getCouponEngineAddress(): string {
    return process.env.COUPON_ENGINE_ADDRESS!;
  }

  getDexRouterAddress(): string {
    return process.env.DEX_ROUTER_ADDRESS!;
  }

  getProjectRegistryAddress(): string {
    return process.env.PROJECT_REGISTRY_ADDRESS!;
  }

  getOracleConsumerAddress(): string {
    return process.env.ORACLE_CONSUMER_ADDRESS!;
  }

  getCreditRetirementAddress(): string {
    return process.env.CREDIT_RETIREMENT_ADDRESS!;
  }
}