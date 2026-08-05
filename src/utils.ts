export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstDefined(record: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    let current: unknown = record;
    for (const part of path.split(".")) {
      if (!isRecord(current) || !(part in current)) {
        current = undefined;
        break;
      }
      current = current[part];
    }
    if (current !== undefined && current !== null && current !== "") {
      return current;
    }
  }
  return undefined;
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export function parsePrice(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[,₹\s]/g, "").replace(/[^0-9.-]/g, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function parseAvailability(record: Record<string, unknown>, fallback = true): boolean {
  const raw = firstDefined(record, [
    "available",
    "isAvailable",
    "inStock",
    "isInStock",
    "stock.available",
    "availability.available",
    "stockStatus",
    "availability",
    "status"
  ]);
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw > 0;
  if (typeof raw === "string") {
    const value = raw.toLowerCase().replace(/[\s_-]/g, "");
    if (["available", "instock", "true", "yes"].includes(value)) return true;
    if (["unavailable", "outofstock", "soldout", "false", "no"].includes(value)) return false;
  }
  return fallback;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9._~-]+/g, "[REDACTED_TOKEN]")
    .slice(0, 500);
}

export function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const raw = error.status ?? error.statusCode ?? error.code;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^\d{3}$/.test(raw)) return Number(raw);
  return undefined;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
