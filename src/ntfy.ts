import { Database } from "./db.js";
import type { AppConfig, Env, ProductVariant } from "./types.js";
import { AppError } from "./types.js";
import { getDefaultProductLink } from "./deals.js";
import { sleep } from "./utils.js";

function formatRupees(value?: number): string {
  if (value === undefined) return "unknown";
  return `₹${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}`;
}

export interface Notifier {
  sendDeal(variant: ProductVariant): Promise<void>;
}

export class NtfyNotifier implements Notifier {
  constructor(
    private readonly env: Pick<Env, "NTFY_ACCESS_TOKEN">,
    private readonly config: AppConfig
  ) {}

  private async send(body: string, headers: Record<string, string>): Promise<void> {
    const target = `${this.config.ntfyBaseUrl}/${encodeURIComponent(this.config.ntfyTopic)}`;
    let lastStatus: number | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(target, {
        method: "POST",
        headers: {
          ...headers,
          ...(this.env.NTFY_ACCESS_TOKEN
            ? { Authorization: `Bearer ${this.env.NTFY_ACCESS_TOKEN}` }
            : {})
        },
        body
      });
      if (response.ok) return;
      lastStatus = response.status;
      if (response.status < 500 && response.status !== 429) break;
      if (attempt < 2) {
        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 500 * 2 ** attempt;
        await sleep(Math.min(waitMs, 10_000));
      }
    }
    throw new AppError("NTFY_FAILED", `ntfy returned HTTP ${lastStatus ?? "unknown"}`, 502);
  }

  async sendDeal(variant: ProductVariant): Promise<void> {
    const details = [
      variant.packSize,
      `${formatRupees(variant.sellingPrice)}${variant.mrp !== undefined ? ` (MRP ${formatRupees(variant.mrp)})` : ""}`,
      variant.discountPct !== undefined ? `${variant.discountPct.toFixed(2)}% off` : undefined
    ].filter(Boolean);
    await this.send(`${variant.productName}\n${details.join(" · ")}`, {
      Title: "🔥 NOICE deal found",
      Priority: "high",
      Tags: "fire,shopping_cart",
      Click: variant.productUrl ?? getDefaultProductLink()
    });
  }

  async sendAuthorizationRequired(): Promise<void> {
    await this.send("Open the monitor and authorize your Swiggy account to resume five-minute checks.", {
      Title: "NOICE monitor needs Swiggy authorization",
      Priority: "high",
      Tags: "warning,lock",
      Click: `${this.config.publicBaseUrl}/auth/start`
    });
  }
}

export async function notifyAuthorizationRequiredOnce(
  db: Database,
  notifier: NtfyNotifier,
  reason: string
): Promise<void> {
  if (await db.getNotificationState("auth_required")) return;
  await notifier.sendAuthorizationRequired();
  await db.setNotificationState("auth_required", `${new Date().toISOString()}:${reason}`);
}
