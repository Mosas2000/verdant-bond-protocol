export enum OrderStatus {
  Open = 'Open',
  PartiallyFilled = 'PartiallyFilled',
  Filled = 'Filled',
  Cancelled = 'Cancelled',
  Expired = 'Expired',
}

export type QuoteAsset = 'USDC' | 'XLM';

export interface OrderResponse {
  id: number;
  seller: string;
  bondId: number;
  amount: string;
  pricePerToken: string;
  quoteAsset: QuoteAsset;
  status: OrderStatus;
  createdAt: string;
}

export interface QuoteBalanceResponse {
  address: string;
  asset: QuoteAsset;
  balance: string;
}

export interface QuoteTransactionResponse {
  address: string;
  asset: QuoteAsset;
  amount: number;
  transactionHash?: string;
}

export interface PriceFeedResponse {
  bondId: number;
  bestPrice: string;
  averagePrice: string;
  totalOrders: number;
  totalVolume: string;
}

export interface PriceLevel {
  price: string;
  amount: string;
  total: string;
}

export type FillabilityStatus = 'fully_fillable' | 'partially_fillable' | 'unfillable';

export interface SlippageResponse {
  bondId: number;
  requestedAmount: string;
  fillableAmount: string;
  unfilledAmount: string;
  averagePrice: string;
  estimatedTotal: string;
  slippagePercent: number;
  fillabilityStatus: FillabilityStatus;
}
