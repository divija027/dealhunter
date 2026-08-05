import { describe, expect, it } from "vitest";
import { runMonitor, type MonitorStore } from "../src/monitor.js";
import type { CatalogResult, ProductVariant, RunSource } from "../src/types.js";
import type { Notifier } from "../src/ntfy.js";

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    variantKey: "product:spin",
    productName: "NOICE Cookies",
    available: true,
    sellingPrice: 15,
    mrp: 100,
    discountPct: 85,
    qualifies: true,
    ...overrides
  };
}

class FakeStore implements MonitorStore {
  active = new Set<string>();
  failedRuns: Array<{ code: string; message: string }> = [];
  finished: Array<{ status: string; alertCount: number }> = [];

  async startRun(_runId: string, _source: RunSource, _startedAt: string): Promise<void> {}

  async finishRun(
    _runId: string,
    _finishedAt: string,
    values: { status: "success" | "partial"; alertCount: number }
  ): Promise<void> {
    this.finished.push(values);
  }

  async failRun(_runId: string, _finishedAt: string, code: string, message: string): Promise<void> {
    this.failedRuns.push({ code, message });
  }

  async loadActiveAlertKeys(): Promise<Set<string>> {
    return new Set(this.active);
  }

  async recordCatalog(_runId: string, _observedAt: string, variants: ProductVariant[]): Promise<void> {
    const seen = new Set(variants.map(item => item.variantKey));
    for (const key of [...this.active]) {
      const current = variants.find(item => item.variantKey === key);
      if (!seen.has(key) || !current?.qualifies) this.active.delete(key);
    }
  }

  async markAlertSent(item: ProductVariant): Promise<void> {
    this.active.add(item.variantKey);
  }
}

class FakeNotifier implements Notifier {
  sent: string[] = [];
  shouldFail = false;

  async sendDeal(item: ProductVariant): Promise<void> {
    if (this.shouldFail) throw new Error("ntfy unavailable");
    this.sent.push(item.variantKey);
  }
}

function catalog(current: ProductVariant): { searchNoice(addressId: string): Promise<CatalogResult> } {
  return {
    async searchNoice(addressId: string) {
      expect(addressId).toBe("address-1");
      return { productCount: 1, variants: [current] };
    }
  };
}

describe("runMonitor", () => {
  it("alerts once while active and alerts again only after re-entry", async () => {
    const store = new FakeStore();
    const notifier = new FakeNotifier();
    let current = variant();
    const provider = { searchNoice: async () => ({ productCount: 1, variants: [current] }) };
    const dependencies = { catalog: provider, store, notifier, randomId: () => crypto.randomUUID() };

    await runMonitor(dependencies, "address-1", "manual");
    await runMonitor(dependencies, "address-1", "cron");
    expect(notifier.sent).toEqual(["product:spin"]);

    current = variant({ sellingPrice: 80, discountPct: 20, qualifies: false });
    await runMonitor(dependencies, "address-1", "cron");
    current = variant({ sellingPrice: 10, discountPct: 90, qualifies: true });
    await runMonitor(dependencies, "address-1", "cron");
    expect(notifier.sent).toEqual(["product:spin", "product:spin"]);
  });

  it("keeps a candidate inactive when notification fails so the next run retries", async () => {
    const store = new FakeStore();
    const notifier = new FakeNotifier();
    notifier.shouldFail = true;
    const first = await runMonitor({ catalog: catalog(variant()), store, notifier }, "address-1", "cron");
    expect(first.status).toBe("partial");
    expect(store.active.size).toBe(0);

    notifier.shouldFail = false;
    const second = await runMonitor({ catalog: catalog(variant()), store, notifier }, "address-1", "cron");
    expect(second.alertCount).toBe(1);
    expect(store.active.has("product:spin")).toBe(true);
  });

  it("fails closed on an empty catalog without recording state", async () => {
    const store = new FakeStore();
    store.active.add("product:spin");
    const notifier = new FakeNotifier();
    const provider = { searchNoice: async () => ({ productCount: 0, variants: [] }) };

    await expect(runMonitor({ catalog: provider, store, notifier }, "address-1", "cron")).rejects.toMatchObject({
      code: "CATALOG_EMPTY"
    });
    expect(store.active.has("product:spin")).toBe(true);
    expect(store.failedRuns[0]?.code).toBe("CATALOG_EMPTY");
  });
});
