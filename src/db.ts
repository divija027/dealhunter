import type { ProductVariant, RunSource } from "./types.js";

interface OauthAttemptRow {
  state: string;
  code_verifier: string;
  redirect_uri: string;
  expires_at: string;
}

interface TokenRow {
  encrypted_access_token: string;
  expires_at: string;
  scope: string | null;
}

interface MonitorRunRow {
  run_id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  product_count: number;
  variant_count: number;
  qualifying_count: number;
  alert_count: number;
  error_code: string | null;
  error_message: string | null;
}

const BATCH_SIZE = 50;

export class Database {
  constructor(private readonly db: D1Database) {}

  async getSetting(key: string): Promise<string | undefined> {
    const row = await this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .bind(key)
      .first<{ value: string }>();
    return row?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      )
      .bind(key, value)
      .run();
  }

  async deleteSetting(key: string): Promise<void> {
    await this.db.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
  }

  async saveOauthAttempt(state: string, verifier: string, redirectUri: string, expiresAt: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO oauth_attempts (state, code_verifier, redirect_uri, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(state, verifier, redirectUri, expiresAt)
      .run();
  }

  async consumeOauthAttempt(state: string, now: string): Promise<OauthAttemptRow | undefined> {
    const attempt = await this.db
      .prepare(
        `SELECT state, code_verifier, redirect_uri, expires_at
         FROM oauth_attempts WHERE state = ? AND expires_at > ?`
      )
      .bind(state, now)
      .first<OauthAttemptRow>();
    await this.db.prepare("DELETE FROM oauth_attempts WHERE state = ?").bind(state).run();
    await this.db.prepare("DELETE FROM oauth_attempts WHERE expires_at <= ?").bind(now).run();
    return attempt ?? undefined;
  }

  async saveEncryptedToken(encrypted: string, expiresAt: string, scope?: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO oauth_tokens (provider, encrypted_access_token, expires_at, scope, updated_at)
         VALUES ('swiggy', ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(provider) DO UPDATE SET
           encrypted_access_token = excluded.encrypted_access_token,
           expires_at = excluded.expires_at,
           scope = excluded.scope,
           updated_at = CURRENT_TIMESTAMP`
      )
      .bind(encrypted, expiresAt, scope ?? null)
      .run();
  }

  async getEncryptedToken(): Promise<TokenRow | undefined> {
    const token = await this.db
      .prepare(
        `SELECT encrypted_access_token, expires_at, scope
         FROM oauth_tokens WHERE provider = 'swiggy'`
      )
      .first<TokenRow>();
    return token ?? undefined;
  }

  async deleteToken(): Promise<void> {
    await this.db.prepare("DELETE FROM oauth_tokens WHERE provider = 'swiggy'").run();
    await this.deleteSetting("mcp_session_id");
  }

  async tryAcquireMonitorLock(now: string, expiresAt: string): Promise<string | undefined> {
    const row = await this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('monitor_lock', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
         WHERE settings.value <= ?
         RETURNING value`
      )
      .bind(expiresAt, now)
      .first<{ value: string }>();
    return row?.value === expiresAt ? expiresAt : undefined;
  }

  async releaseMonitorLock(lockValue: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM settings WHERE key = 'monitor_lock' AND value = ?")
      .bind(lockValue)
      .run();
  }

  async startRun(runId: string, source: RunSource, startedAt: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO monitor_runs (run_id, source, started_at, status)
         VALUES (?, ?, ?, 'running')`
      )
      .bind(runId, source, startedAt)
      .run();
  }

  async finishRun(
    runId: string,
    finishedAt: string,
    values: {
      status: "success" | "partial";
      productCount: number;
      variantCount: number;
      qualifyingCount: number;
      alertCount: number;
      errorCode?: string;
      errorMessage?: string;
    }
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE monitor_runs SET
           finished_at = ?, status = ?, product_count = ?, variant_count = ?,
           qualifying_count = ?, alert_count = ?, error_code = ?, error_message = ?
         WHERE run_id = ?`
      )
      .bind(
        finishedAt,
        values.status,
        values.productCount,
        values.variantCount,
        values.qualifyingCount,
        values.alertCount,
        values.errorCode ?? null,
        values.errorMessage ?? null,
        runId
      )
      .run();
  }

  async failRun(runId: string, finishedAt: string, code: string, message: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE monitor_runs SET finished_at = ?, status = 'failed', error_code = ?, error_message = ?
         WHERE run_id = ?`
      )
      .bind(finishedAt, code, message, runId)
      .run();
  }

  async loadActiveAlertKeys(): Promise<Set<string>> {
    const rows = await this.db
      .prepare("SELECT variant_key FROM alert_states WHERE active = 1")
      .all<{ variant_key: string }>();
    return new Set((rows.results ?? []).map(row => row.variant_key));
  }

  async recordCatalog(runId: string, observedAt: string, variants: ProductVariant[]): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    for (const variant of variants) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO product_variants (
               variant_key, product_id, spin_id, product_name, brand, pack_size, product_url,
               available, selling_price, mrp, discount_pct, qualifies, last_seen_at,
               last_successful_run_id, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(variant_key) DO UPDATE SET
               product_id = excluded.product_id, spin_id = excluded.spin_id,
               product_name = excluded.product_name, brand = excluded.brand,
               pack_size = excluded.pack_size, product_url = excluded.product_url,
               available = excluded.available, selling_price = excluded.selling_price,
               mrp = excluded.mrp, discount_pct = excluded.discount_pct,
               qualifies = excluded.qualifies, last_seen_at = excluded.last_seen_at,
               last_successful_run_id = excluded.last_successful_run_id,
               updated_at = CURRENT_TIMESTAMP`
          )
          .bind(
            variant.variantKey,
            variant.productId ?? null,
            variant.spinId ?? null,
            variant.productName,
            variant.brand ?? null,
            variant.packSize ?? null,
            variant.productUrl ?? null,
            variant.available ? 1 : 0,
            variant.sellingPrice ?? null,
            variant.mrp ?? null,
            variant.discountPct ?? null,
            variant.qualifies ? 1 : 0,
            observedAt,
            runId
          ),
        this.db
          .prepare(
            `INSERT INTO price_observations (
               run_id, variant_key, observed_at, available, selling_price, mrp, discount_pct, qualifies
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            runId,
            variant.variantKey,
            observedAt,
            variant.available ? 1 : 0,
            variant.sellingPrice ?? null,
            variant.mrp ?? null,
            variant.discountPct ?? null,
            variant.qualifies ? 1 : 0
          ),
        this.db
          .prepare(
            `INSERT INTO alert_states (variant_key, active, updated_at)
             VALUES (?, 0, CURRENT_TIMESTAMP)
             ON CONFLICT(variant_key) DO UPDATE SET
               active = CASE WHEN ? = 0 THEN 0 ELSE alert_states.active END,
               updated_at = CURRENT_TIMESTAMP`
          )
          .bind(variant.variantKey, variant.qualifies ? 1 : 0)
      );
    }

    for (let index = 0; index < statements.length; index += BATCH_SIZE) {
      await this.db.batch(statements.slice(index, index + BATCH_SIZE));
    }

    await this.db.batch([
      this.db
        .prepare(
          `UPDATE product_variants SET available = 0, qualifies = 0, updated_at = CURRENT_TIMESTAMP
           WHERE last_successful_run_id != ?`
        )
        .bind(runId),
      this.db
        .prepare(
          `UPDATE alert_states SET active = 0, updated_at = CURRENT_TIMESTAMP
           WHERE variant_key IN (
             SELECT variant_key FROM product_variants WHERE last_successful_run_id != ?
           )`
        )
        .bind(runId)
    ]);
  }

  async markAlertSent(variant: ProductVariant, alertedAt: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE alert_states SET active = 1, last_alerted_at = ?, last_alerted_price = ?,
         updated_at = CURRENT_TIMESTAMP WHERE variant_key = ?`
      )
      .bind(alertedAt, variant.sellingPrice ?? null, variant.variantKey)
      .run();
  }

  async getNotificationState(key: string): Promise<string | undefined> {
    const row = await this.db
      .prepare("SELECT value FROM notification_state WHERE key = ?")
      .bind(key)
      .first<{ value: string }>();
    return row?.value;
  }

  async setNotificationState(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO notification_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      )
      .bind(key, value)
      .run();
  }

  async deleteNotificationState(key: string): Promise<void> {
    await this.db.prepare("DELETE FROM notification_state WHERE key = ?").bind(key).run();
  }

  async cleanupOldData(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const lastCleanup = await this.getSetting("last_cleanup_at");
    if (lastCleanup && now.getTime() - Date.parse(lastCleanup) < 24 * 60 * 60 * 1000) return;
    await this.db.batch([
      this.db.prepare("DELETE FROM price_observations WHERE observed_at < ?").bind(cutoff),
      this.db.prepare("DELETE FROM monitor_runs WHERE started_at < ?").bind(cutoff),
      this.db.prepare("DELETE FROM oauth_attempts WHERE expires_at <= ?").bind(now.toISOString())
    ]);
    await this.setSetting("last_cleanup_at", now.toISOString());
  }

  async getLatestRun(): Promise<MonitorRunRow | undefined> {
    const row = await this.db
      .prepare(
        `SELECT run_id, source, started_at, finished_at, status, product_count, variant_count,
                qualifying_count, alert_count, error_code, error_message
         FROM monitor_runs ORDER BY started_at DESC LIMIT 1`
      )
      .first<MonitorRunRow>();
    return row ?? undefined;
  }

  async getProductStats(): Promise<{ tracked: number; activeDeals: number }> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS tracked,
                SUM(CASE WHEN qualifies = 1 AND available = 1 THEN 1 ELSE 0 END) AS active_deals
         FROM product_variants`
      )
      .first<{ tracked: number; active_deals: number | null }>();
    return { tracked: row?.tracked ?? 0, activeDeals: row?.active_deals ?? 0 };
  }
}

export type { MonitorRunRow, OauthAttemptRow, TokenRow };
