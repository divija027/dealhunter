export interface Env {
  DB: D1Database;
  SWIGGY_MCP_URL: string;
  SWIGGY_OAUTH_BASE_URL: string;
  DEAL_MAX_PRICE: string;
  DEAL_MIN_DISCOUNT_PCT: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  TOKEN_ENCRYPTION_KEY: string;
  NTFY_BASE_URL: string;
  NTFY_TOPIC: string;
  NTFY_ACCESS_TOKEN?: string;
  PUBLIC_BASE_URL: string;
}

export interface AppConfig {
  swiggyMcpUrl: string;
  swiggyOauthBaseUrl: string;
  maxPrice: number;
  minDiscountPct: number;
  ntfyBaseUrl: string;
  ntfyTopic: string;
  publicBaseUrl: string;
}

export interface OAuthToken {
  accessToken: string;
  expiresAt: string;
  scope?: string;
}

export interface SavedAddress {
  id: string;
  label: string;
}

export interface ProductVariant {
  variantKey: string;
  productId?: string;
  spinId?: string;
  productName: string;
  brand?: string;
  packSize?: string;
  productUrl?: string;
  available: boolean;
  sellingPrice?: number;
  mrp?: number;
  discountPct?: number;
  qualifies: boolean;
}

export interface CatalogResult {
  productCount: number;
  variants: ProductVariant[];
}

export type RunSource = "cron" | "manual";

export interface RunSummary {
  runId: string;
  status: "success" | "partial";
  productCount: number;
  variantCount: number;
  qualifyingCount: number;
  alertCount: number;
  notificationFailures: number;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "AppError";
  }
}
