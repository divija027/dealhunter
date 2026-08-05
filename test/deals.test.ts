import { describe, expect, it } from "vitest";
import { normalizeProducts, qualifiesAsDeal } from "../src/deals.js";

const rules = { maxPrice: 25, minDiscountPct: 70 };

describe("qualifiesAsDeal", () => {
  it("accepts exact price and discount boundaries", () => {
    expect(qualifiesAsDeal(true, 25, 0, rules)).toBe(true);
    expect(qualifiesAsDeal(true, 100, 70, rules)).toBe(true);
  });

  it("requires stock, a price, and at least one matching rule", () => {
    expect(qualifiesAsDeal(false, 10, 90, rules)).toBe(false);
    expect(qualifiesAsDeal(true, undefined, 90, rules)).toBe(false);
    expect(qualifiesAsDeal(true, 25.01, 69.99, rules)).toBe(false);
  });
});

describe("normalizeProducts", () => {
  it("normalizes NOICE variants and calculates discounts from MRP", () => {
    const variants = normalizeProducts(
      [
        {
          productId: "product-1",
          name: "NOICE Oat & Chocochip Cookies",
          brand: { name: "NOICE" },
          variations: [
            {
              spinId: "spin-1",
              quantityDescription: "80 g",
              pricing: { sellingPrice: "₹15", mrp: "₹100" },
              stockStatus: "IN_STOCK"
            }
          ]
        }
      ],
      rules
    );

    expect(variants).toEqual([
      expect.objectContaining({
        variantKey: "product-1:spin-1",
        productName: "NOICE Oat & Chocochip Cookies",
        packSize: "80 g",
        sellingPrice: 15,
        mrp: 100,
        discountPct: 85,
        available: true,
        qualifies: true
      })
    ]);
  });

  it("filters unrelated and similar-brand products", () => {
    const variants = normalizeProducts(
      [
        { id: "1", name: "Nice Cookies", brand: "Nice", price: 10 },
        { id: "2", name: "NOICE Cashew Cookies", brand: "NOICE", price: 20 }
      ],
      rules
    );
    expect(variants).toHaveLength(1);
    expect(variants[0]?.productName).toBe("NOICE Cashew Cookies");
  });

  it("does not trust invalid or inflated discount inputs", () => {
    const variants = normalizeProducts(
      [
        {
          id: "1",
          name: "NOICE Bread",
          brand: "NOICE",
          variations: [{ id: "v1", sellingPrice: 80, mrp: 100, discountPct: 90 }]
        }
      ],
      rules
    );
    expect(variants[0]?.discountPct).toBe(20);
    expect(variants[0]?.qualifies).toBe(false);
  });
});
