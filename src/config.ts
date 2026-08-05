import { AppError, type AppConfig, type Env } from "./types.js";

function positiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError("CONFIG_INVALID", `${name} must be a non-negative number`);
  }
  return parsed;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new AppError("CONFIG_MISSING", `${name} is not configured`);
  }
  return value.trim();
}

function validUrl(value: string | undefined, name: string): string {
  const raw = required(value, name);
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    throw new AppError("CONFIG_INVALID", `${name} must be an absolute URL`);
  }
}

export function getConfig(env: Env): AppConfig {
  const publicBaseUrl = validUrl(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL");
  if (publicBaseUrl.includes("REPLACE_WITH")) {
    throw new AppError("CONFIG_INVALID", "PUBLIC_BASE_URL still contains its placeholder");
  }

  return {
    swiggyMcpUrl: validUrl(env.SWIGGY_MCP_URL, "SWIGGY_MCP_URL"),
    swiggyOauthBaseUrl: validUrl(env.SWIGGY_OAUTH_BASE_URL, "SWIGGY_OAUTH_BASE_URL"),
    maxPrice: positiveNumber(env.DEAL_MAX_PRICE, "DEAL_MAX_PRICE"),
    minDiscountPct: positiveNumber(env.DEAL_MIN_DISCOUNT_PCT, "DEAL_MIN_DISCOUNT_PCT"),
    ntfyBaseUrl: validUrl(env.NTFY_BASE_URL, "NTFY_BASE_URL"),
    ntfyTopic: required(env.NTFY_TOPIC, "NTFY_TOPIC"),
    publicBaseUrl
  };
}

export function assertRuntimeSecrets(env: Env): void {
  required(env.ADMIN_PASSWORD, "ADMIN_PASSWORD");
  required(env.TOKEN_ENCRYPTION_KEY, "TOKEN_ENCRYPTION_KEY");
  required(env.NTFY_TOPIC, "NTFY_TOPIC");
}
