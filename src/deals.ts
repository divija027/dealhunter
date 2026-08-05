import type { AppConfig, ProductVariant } from "./types.js";
import {
  firstDefined,
  isRecord,
  parseAvailability,
  parsePrice,
  roundMoney,
  stringValue
} from "./utils.js";

const DEFAULT_PRODUCT_LINK = "https://www.swiggy.com/instamart/search?query=NOICE";

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasNoiceIdentity(name: string, brand?: string): boolean {
  return brand?.trim().toLowerCase() === "noice" || /(?:^|\s)noice(?:\s|$)/i.test(name);
}

function calculateDiscount(sellingPrice?: number, mrp?: number): number | undefined {
  if (sellingPrice === undefined || mrp === undefined || mrp <= 0 || sellingPrice > mrp) {
    return undefined;
  }
  return roundMoney(((mrp - sellingPrice) / mrp) * 100);
}

export function qualifiesAsDeal(
  available: boolean,
  sellingPrice: number | undefined,
  discountPct: number | undefined,
  config: Pick<AppConfig, "maxPrice" | "minDiscountPct">
): boolean {
  if (!available || sellingPrice === undefined) return false;
  return sellingPrice <= config.maxPrice || (discountPct ?? -1) >= config.minDiscountPct;
}

function normalizeVariation(
  product: Record<string, unknown>,
  variation: Record<string, unknown>,
  config: Pick<AppConfig, "maxPrice" | "minDiscountPct">,
  index: number
): ProductVariant | undefined {
  const productName = stringValue(
    firstDefined(product, ["name", "productName", "title", "displayName", "itemName"])
  );
  if (!productName) return undefined;

  const brand = stringValue(firstDefined(product, ["brand.name", "brand", "brandName"]));
  if (!hasNoiceIdentity(productName, brand)) return undefined;

  const productId = stringValue(
    firstDefined(product, ["productId", "id", "itemId", "catalogItemId", "skuId"])
  );
  const spinId = stringValue(
    firstDefined(variation, ["spinId", "spin", "variationId", "variantId", "id"])
  );
  const packSize = stringValue(
    firstDefined(variation, [
      "quantityDescription",
      "quantity",
      "packSize",
      "variant",
      "displayName",
      "name"
    ])
  );
  const sellingPrice = parsePrice(
    firstDefined(variation, [
      "pricing.sellingPrice",
      "pricing.finalPrice",
      "pricing.offerPrice",
      "pricing.price",
      "sellingPrice",
      "finalPrice",
      "offerPrice",
      "price"
    ])
  );
  const mrp = parsePrice(
    firstDefined(variation, ["pricing.mrp", "pricing.originalPrice", "mrp", "originalPrice"])
  );
  const available = parseAvailability(variation, parseAvailability(product, true));
  const discountPct = calculateDiscount(sellingPrice, mrp);
  const productUrl =
    stringValue(firstDefined(variation, ["productUrl", "url", "deepLink", "deeplink"])) ??
    stringValue(firstDefined(product, ["productUrl", "url", "deepLink", "deeplink"])) ??
    DEFAULT_PRODUCT_LINK;
  const stableProduct = productId ?? productName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const stableVariation = spinId ?? packSize?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? String(index);

  return {
    variantKey: `${stableProduct}:${stableVariation}`,
    productId,
    spinId,
    productName,
    brand,
    packSize,
    productUrl,
    available,
    sellingPrice,
    mrp,
    discountPct,
    qualifies: qualifiesAsDeal(available, sellingPrice, discountPct, config)
  };
}

export function normalizeProducts(
  products: unknown,
  config: Pick<AppConfig, "maxPrice" | "minDiscountPct">
): ProductVariant[] {
  const normalized: ProductVariant[] = [];
  for (const rawProduct of arrayValue(products)) {
    if (!isRecord(rawProduct)) continue;
    const rawVariations = firstDefined(rawProduct, ["variations", "variants", "items"]);
    const variations = arrayValue(rawVariations);
    const effectiveVariations = variations.length > 0 ? variations : [rawProduct];
    effectiveVariations.forEach((rawVariation, index) => {
      if (!isRecord(rawVariation)) return;
      const variant = normalizeVariation(rawProduct, rawVariation, config, index);
      if (variant) normalized.push(variant);
    });
  }
  return normalized;
}

export function getDefaultProductLink(): string {
  return DEFAULT_PRODUCT_LINK;
}
