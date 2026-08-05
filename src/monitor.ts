import { Database } from "./db.js";
import type { CatalogResult, ProductVariant, RunSource, RunSummary } from "./types.js";
import { AppError } from "./types.js";
import type { Notifier } from "./ntfy.js";
import { redactError } from "./utils.js";

export interface CatalogProvider {
  searchNoice(addressId: string): Promise<CatalogResult>;
}

export interface MonitorStore {
  startRun(runId: string, source: RunSource, startedAt: string): Promise<void>;
  finishRun(
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
  ): Promise<void>;
  failRun(runId: string, finishedAt: string, code: string, message: string): Promise<void>;
  loadActiveAlertKeys(): Promise<Set<string>>;
  recordCatalog(runId: string, observedAt: string, variants: ProductVariant[]): Promise<void>;
  markAlertSent(variant: ProductVariant, alertedAt: string): Promise<void>;
}

export interface MonitorDependencies {
  catalog: CatalogProvider;
  store: MonitorStore;
  notifier: Notifier;
  now?: () => Date;
  randomId?: () => string;
}

export async function runMonitor(
  dependencies: MonitorDependencies,
  addressId: string,
  source: RunSource
): Promise<RunSummary> {
  const now = dependencies.now ?? (() => new Date());
  const runId = dependencies.randomId?.() ?? crypto.randomUUID();
  const startedAt = now().toISOString();
  await dependencies.store.startRun(runId, source, startedAt);

  try {
    const activeBeforeRun = await dependencies.store.loadActiveAlertKeys();
    const catalog = await dependencies.catalog.searchNoice(addressId);
    if (catalog.productCount <= 0 || catalog.variants.length <= 0) {
      throw new AppError("CATALOG_EMPTY", "Catalog contained no NOICE products; previous state was preserved", 502);
    }
    const observedAt = now().toISOString();
    await dependencies.store.recordCatalog(runId, observedAt, catalog.variants);

    const candidates = catalog.variants.filter(variant => variant.qualifies && !activeBeforeRun.has(variant.variantKey));
    let alertCount = 0;
    let notificationFailures = 0;
    for (const variant of candidates) {
      try {
        await dependencies.notifier.sendDeal(variant);
        await dependencies.store.markAlertSent(variant, now().toISOString());
        alertCount += 1;
      } catch (error) {
        notificationFailures += 1;
        console.error(JSON.stringify({ event: "notification_failed", variantKey: variant.variantKey, error: redactError(error) }));
      }
    }

    const qualifyingCount = catalog.variants.filter(variant => variant.qualifies).length;
    const status = notificationFailures > 0 ? "partial" : "success";
    await dependencies.store.finishRun(runId, now().toISOString(), {
      status,
      productCount: catalog.productCount,
      variantCount: catalog.variants.length,
      qualifyingCount,
      alertCount,
      errorCode: notificationFailures > 0 ? "NOTIFICATION_FAILED" : undefined,
      errorMessage:
        notificationFailures > 0 ? `${notificationFailures} deal notification(s) will be retried` : undefined
    });
    return {
      runId,
      status,
      productCount: catalog.productCount,
      variantCount: catalog.variants.length,
      qualifyingCount,
      alertCount,
      notificationFailures
    };
  } catch (error) {
    const appError = error instanceof AppError ? error : new AppError("MONITOR_FAILED", redactError(error));
    await dependencies.store.failRun(runId, now().toISOString(), appError.code, redactError(appError));
    throw appError;
  }
}

export async function runWithDatabaseLock<T>(db: Database, operation: () => Promise<T>): Promise<T> {
  const now = new Date();
  const lockExpiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const lock = await db.tryAcquireMonitorLock(now.toISOString(), lockExpiresAt);
  if (!lock) throw new AppError("MONITOR_ALREADY_RUNNING", "Another catalog check is already running", 409);
  try {
    return await operation();
  } finally {
    await db.releaseMonitorLock(lock);
  }
}
