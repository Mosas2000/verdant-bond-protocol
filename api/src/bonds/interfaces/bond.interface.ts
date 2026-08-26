export enum CreditTypeEnum {
  Carbon = 'Carbon',
  Biodiversity = 'Biodiversity',
  Basket = 'Basket',
  BlueCarbon = 'BlueCarbon',
}

export enum BondStatusEnum {
  Active = 'Active',
  Matured = 'Matured',
  Defaulted = 'Defaulted',
}

export enum BondMaturityStatusEnum {
  Active = 'Active',
  Matured = 'Matured',
}

export interface BondResponse {
  id: number;
  projectId: string;
  faceValue: string;
  couponSchedule: string[];
  creditType: CreditTypeEnum;
  maturityDate: number;
  maturityStatus: BondMaturityStatusEnum;
  totalSupply: string;
  totalSubscribed: string;
  status: BondStatusEnum;
  createdAt: string;
  /** Only present on the response to a just-submitted issuance (see
   *  BondsService.create); absent on reads. */
  transactionHash?: string;
}

export interface HeldBondResponse extends BondResponse {
  balance: string;
}

export interface SubscriptionResponse {
  bondId: number;
  investorAddress: string;
  amount: string;
  transactionHash: string;
}

export interface HolderListResponse {
  bondId: number;
  holders: Array<{ address: string; balance: string }>;
  total: number;
}

export interface CouponDistributionResponse {
  bondId: number;
  periodIndex: number;
  totalCredits: string;
  holderCount: number;
}

export interface ClaimCreditsResponse {
  bondId: number;
  investorAddress: string;
  credits: string;
  transactionHash: string;
}

export interface TransferResponse {
  bondId: number;
  fromAddress: string;
  toAddress: string;
  amount: string;
  transactionHash: string;
}

export interface UndistributedTotalResponse {
  bondId: number;
  undistributedTotal: string;
}

export interface SweepUndistributedResponse {
  bondId: number;
  swept: string;
  transactionHash: string;
}
