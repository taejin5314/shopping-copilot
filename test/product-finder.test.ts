import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findProducts,
  candidateToProductInfo,
  buildSearchQuery,
  ProductCandidateSchema,
} from "../src/domain/product-finder.js";
import type { ProductCandidate, ProductFinderInput } from "../src/domain/product-finder.js";
import type { RetailerAdapter, SearchOpts, FindStoresOpts } from "../src/core/adapter.js";
import type { ProductInfo, StoreRef, StoreStock, ProductRef } from "../src/core/types.js";
import type { QueryUnderstandingOutput } from "../src/llm/query-understanding.js";

// ── Test helpers ──

function makeProduct(overrides: Partial<ProductInfo> & { itemNo: string; name: string }): ProductInfo {
  return {
    retailer: "test",
    typeName: "Furniture",
    price: { amount: 500, currency: "CAD" },
    url: `https://example.com/${overrides.itemNo}`,
    measureText: null,
    designText: null,
    imageUrl: null,
    ...overrides,
  };
}

function fakeAdapter(retailerId: string, products: ProductInfo[]): RetailerAdapter {
  return {
    retailerId,
    listStores: async (_countryCode?: string): Promise<StoreRef[]> => [],
    searchProducts: async (_query: string, _opts?: SearchOpts): Promise<ProductInfo[]> => products,
    checkStock: async (_items: ProductRef[], _storeIds: string[]): Promise<StoreStock[]> => [],
    findStoresForCart: async (
      _items: Array<{ itemNo: string; quantity: number }>,
      _opts?: FindStoresOpts,
    ): Promise<StoreStock[]> => [],
  };
}

function throwingAdapter(retailerId: string): RetailerAdapter {
  return {
    retailerId,
    listStores: async (): Promise<StoreRef[]> => [],
    searchProducts: async (): Promise<ProductInfo[]> => { throw new Error("adapter unavailable"); },
    checkStock: async (): Promise<StoreStock[]> => [],
    findStoresForCart: async (): Promise<StoreStock[]> => [],
  };
}

// ── QU fixtures ──

const QU_SOFA_BED: QueryUnderstandingOutput = {
  category: "sofa bed",
  keywords: ["sofa bed", "comfortable"],
  budgetMin: null,
  budgetMax: 800,
  color: null,
  size: null,
  material: null,
  style: null,
  retailerPreference: "all",
  mustBeInStock: false,
  locationTerms: [],
  itemCardinality: "single",
  warnings: [],
};

const QU_IKEA_DESK: QueryUnderstandingOutput = {
  category: "desk",
  keywords: ["desk", "IKEA", "home office"],
  budgetMin: null,
  budgetMax: 600,
  color: "white",
  size: null,
  material: null,
  style: null,
  retailerPreference: "ikea",
  mustBeInStock: false,
  locationTerms: [],
  itemCardinality: "single",
  warnings: [],
};

const QU_MULTI_ITEM: QueryUnderstandingOutput = {
  category: "bedroom furniture",
  keywords: ["bed frame", "mattress"],
  budgetMin: null,
  budgetMax: null,
  color: null,
  size: null,
  material: null,
  style: null,
  retailerPreference: "all",
  mustBeInStock: false,
  locationTerms: [],
  itemCardinality: "multiple",
  warnings: [],
};

const QU_LEATHER_SOFA: QueryUnderstandingOutput = {
  category: "sofa",
  keywords: ["sofa", "leather", "sectional"],
  budgetMin: null,
  budgetMax: null,
  color: null,
  size: null,
  material: "leather",
  style: null,
  retailerPreference: "all",
  mustBeInStock: false,
  locationTerms: [],
  itemCardinality: "single",
  warnings: [],
};

// ── ProductCandidate schema ──

describe("ProductCandidateSchema", () => {
  it("accepts a fully valid candidate", () => {
    const candidate: ProductCandidate = {
      retailer: "ikea",
      productId: "123.456.78",
      variantId: "Dark blue",
      itemNo: "123.456.78",
      name: "SÖDERHAMN Sofa",
      typeName: "Sofa",
      price: 799,
      currency: "CAD",
      url: "https://ikea.com/sofa",
      imageUrl: null,
      matchScore: 0.85,
      matchedFromKeywords: ["sofa"],
      warnings: [],
      measureText: null,
      designText: "Dark blue",
    };
    assert.ok(ProductCandidateSchema.safeParse(candidate).success);
  });

  it("rejects matchScore > 1", () => {
    const r = ProductCandidateSchema.safeParse({
      retailer: "ikea", productId: "x", variantId: null, itemNo: "x",
      name: "Test", typeName: "T", price: null, currency: null, url: null,
      imageUrl: null, matchScore: 1.5, matchedFromKeywords: [], warnings: [],
      measureText: null, designText: null,
    });
    assert.equal(r.success, false);
  });

  it("rejects matchScore < 0", () => {
    const r = ProductCandidateSchema.safeParse({
      retailer: "ikea", productId: "x", variantId: null, itemNo: "x",
      name: "Test", typeName: "T", price: null, currency: null, url: null,
      imageUrl: null, matchScore: -0.1, matchedFromKeywords: [], warnings: [],
      measureText: null, designText: null,
    });
    assert.equal(r.success, false);
  });

  it("rejects missing required fields", () => {
    const r = ProductCandidateSchema.safeParse({ retailer: "ikea", name: "Test" });
    assert.equal(r.success, false);
  });
});

// ── buildSearchQuery ──

describe("buildSearchQuery", () => {
  it("returns rawQuery when quOutput is undefined", () => {
    assert.equal(buildSearchQuery("comfortable sofa bed", undefined), "comfortable sofa bed");
  });

  it("returns rawQuery when keywords array is empty", () => {
    const qu = { ...QU_SOFA_BED, keywords: [] };
    assert.equal(buildSearchQuery("sofa", qu), "sofa");
  });

  it("uses keywords joined when category is already covered", () => {
    const result = buildSearchQuery("sofa bed", QU_SOFA_BED);
    // "sofa bed" is in keywords, so category is not prepended twice
    assert.ok(result.includes("sofa bed"));
  });

  it("prepends category when not present in keywords", () => {
    const qu: QueryUnderstandingOutput = { ...QU_SOFA_BED, category: "sectional sofa", keywords: ["large", "comfortable"] };
    const result = buildSearchQuery("something", qu);
    assert.ok(result.startsWith("sectional sofa"));
  });

  it("caps at 5 terms", () => {
    const qu: QueryUnderstandingOutput = {
      ...QU_SOFA_BED,
      category: "chair",
      keywords: ["ergonomic", "office", "mesh", "adjustable", "armrest", "lumbar"],
    };
    const result = buildSearchQuery("chair", qu);
    assert.ok(result.split(" ").length <= 5);
  });
});

// ── findProducts — core behaviour ──

describe("findProducts", () => {
  it("returns candidates for sofa bed query with budget", async () => {
    const products = [
      makeProduct({ itemNo: "001.001.01", name: "LYCKSELE HÅVET Sofa bed", price: { amount: 699, currency: "CAD" } }),
      makeProduct({ itemNo: "001.001.02", name: "FRIHETEN Sofa bed", price: { amount: 599, currency: "CAD" } }),
    ];
    const result = await findProducts(
      { rawQuery: "comfortable sofa bed under $800", quOutput: QU_SOFA_BED, retailerScope: "all" },
      [fakeAdapter("ikea", products)],
    );
    assert.equal(result.candidates.length, 2);
    assert.ok(result.candidates.every((c) => c.retailer === "ikea"));
    // Both under budget → no budget warnings
    assert.ok(result.candidates.every((c) => !c.warnings.some((w) => w.includes("budget"))));
    assert.ok(result.warnings.length === 0);
  });

  it("adds budget warning to candidate priced above budgetMax", async () => {
    const products = [
      makeProduct({ itemNo: "002.001.01", name: "Premium Sofa Bed", price: { amount: 950, currency: "CAD" } }),
    ];
    const result = await findProducts(
      { rawQuery: "sofa bed", quOutput: QU_SOFA_BED },
      [fakeAdapter("structube", products)],
    );
    assert.equal(result.candidates.length, 1);
    const c = result.candidates[0];
    assert.ok(c.warnings.some((w) => w.toLowerCase().includes("budget")));
    assert.ok(c.matchScore < 0.8); // penalised
  });

  it("adds significantly-over-budget penalty for price > 1.5x budgetMax", async () => {
    const products = [
      makeProduct({ itemNo: "003.001.01", name: "Luxury Sofa Bed", price: { amount: 1400, currency: "CAD" } }),
    ];
    const result = await findProducts(
      { rawQuery: "sofa bed", quOutput: QU_SOFA_BED },
      [fakeAdapter("ikea", products)],
    );
    const c = result.candidates[0];
    assert.ok(c.matchScore < 0.5);
    assert.ok(c.warnings.some((w) => w.toLowerCase().includes("significantly")));
  });

  it("scopes to IKEA adapter only when retailerScope is 'ikea'", async () => {
    const ikeaProducts = [makeProduct({ itemNo: "004.001.01", name: "BEKANT Desk", retailer: "ikea" })];
    const structubeProducts = [makeProduct({ itemNo: "004.002.01", name: "Structube Desk", retailer: "structube" })];
    const result = await findProducts(
      { rawQuery: "desk", quOutput: QU_IKEA_DESK, retailerScope: "ikea" },
      [fakeAdapter("ikea", ikeaProducts), fakeAdapter("structube", structubeProducts)],
    );
    assert.ok(result.candidates.every((c) => c.retailer === "ikea"));
    assert.ok(result.candidates.length > 0);
  });

  it("awards attribute hit bonus for color match", async () => {
    const products = [
      makeProduct({ itemNo: "005.001.01", name: "MICKE Desk white", designText: "white" }),
    ];
    const result = await findProducts(
      { rawQuery: "white desk", quOutput: QU_IKEA_DESK },
      [fakeAdapter("ikea", products)],
    );
    const c = result.candidates[0];
    assert.ok(c.matchScore > 0.8); // bonus applied
    assert.ok(!c.warnings.some((w) => w.toLowerCase().includes("color")));
  });

  it("deducts attribute miss penalty for color mismatch", async () => {
    const products = [
      makeProduct({ itemNo: "005.002.01", name: "ALEX Desk black" }),
    ];
    const result = await findProducts(
      { rawQuery: "white desk", quOutput: QU_IKEA_DESK },
      [fakeAdapter("ikea", products)],
    );
    const c = result.candidates[0];
    assert.ok(c.warnings.some((w) => w.toLowerCase().includes("color")));
    assert.ok(c.matchScore < 0.8); // penalty applied
  });

  it("includes warning for multi-item query", async () => {
    const products = [makeProduct({ itemNo: "006.001.01", name: "MALM Bed frame" })];
    const result = await findProducts(
      { rawQuery: "bed frame and mattress", quOutput: QU_MULTI_ITEM },
      [fakeAdapter("ikea", products)],
    );
    assert.ok(result.warnings.some((w) => w.toLowerCase().includes("multiple product")));
  });

  it("deduplicates identical retailer+itemNo keeping highest scored", async () => {
    // Adapter returns same itemNo twice (e.g. from two search passes)
    const products = [
      makeProduct({ itemNo: "007.001.01", name: "EKTORP Sofa", price: { amount: 700, currency: "CAD" } }),
      makeProduct({ itemNo: "007.001.01", name: "EKTORP Sofa", price: { amount: 700, currency: "CAD" } }),
    ];
    const result = await findProducts(
      { rawQuery: "sofa", quOutput: QU_SOFA_BED },
      [fakeAdapter("ikea", products)],
    );
    assert.equal(result.candidates.length, 1);
  });

  it("keeps variants with different itemNos as distinct candidates", async () => {
    // Same sofa, 3 color variants — each is its own itemNo
    const products = [
      makeProduct({ itemNo: "008.001.01", name: "SÖDERHAMN Sofa", designText: "Beige" }),
      makeProduct({ itemNo: "008.001.02", name: "SÖDERHAMN Sofa", designText: "Dark blue" }),
      makeProduct({ itemNo: "008.001.03", name: "SÖDERHAMN Sofa", designText: "Light grey" }),
    ];
    const result = await findProducts(
      { rawQuery: "sofa", quOutput: QU_SOFA_BED },
      [fakeAdapter("ikea", products)],
    );
    assert.equal(result.candidates.length, 3);
    const variantIds = result.candidates.map((c) => c.variantId);
    assert.ok(variantIds.includes("Beige"));
    assert.ok(variantIds.includes("Dark blue"));
  });

  it("sets matchedFromKeywords based on product text match", async () => {
    const products = [
      makeProduct({ itemNo: "009.001.01", name: "IKEA SÖDERHAMN leather sectional sofa" }),
    ];
    const result = await findProducts(
      { rawQuery: "leather sectional sofa", quOutput: QU_LEATHER_SOFA },
      [fakeAdapter("ikea", products)],
    );
    const c = result.candidates[0];
    assert.ok(c.matchedFromKeywords.includes("leather"));
    assert.ok(c.matchedFromKeywords.includes("sofa"));
  });

  it("adds weak-match warning when all candidates score below threshold", async () => {
    // Product completely mismatches all 4 attributes
    const quAllAttrs: QueryUnderstandingOutput = {
      ...QU_SOFA_BED,
      budgetMax: 100,       // price is 500 — way over budget → big penalty
      color: "red",         // not in product → penalty
      material: "velvet",   // not in product → penalty
      style: "baroque",     // not in product → penalty
    };
    const products = [makeProduct({ itemNo: "010.001.01", name: "Generic Chair" })];
    const result = await findProducts(
      { rawQuery: "chair", quOutput: quAllAttrs },
      [fakeAdapter("ikea", products)],
    );
    assert.ok(result.warnings.some((w) => w.toLowerCase().includes("low match score")));
  });

  it("falls back to all adapters and warns when retailerScope matches nothing", async () => {
    const products = [makeProduct({ itemNo: "011.001.01", name: "Basic Sofa" })];
    const result = await findProducts(
      { rawQuery: "sofa", quOutput: QU_SOFA_BED, retailerScope: "rh" }, // unknown retailer
      [fakeAdapter("ikea", products)],
    );
    assert.ok(result.warnings.some((w) => w.includes("rh")));
    assert.ok(result.candidates.length > 0); // fallback to all adapters
  });

  it("captures adapter error as warning, returns partial results from other adapters", async () => {
    const goodProducts = [makeProduct({ itemNo: "012.001.01", name: "FRIHETEN Sofa Bed" })];
    const result = await findProducts(
      { rawQuery: "sofa bed", quOutput: QU_SOFA_BED },
      [throwingAdapter("structube"), fakeAdapter("ikea", goodProducts)],
    );
    assert.ok(result.warnings.some((w) => w.toLowerCase().includes("structube")));
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].retailer, "ikea");
  });

  it("returns empty candidates with no error when adapter returns no results", async () => {
    const result = await findProducts(
      { rawQuery: "sofa", quOutput: QU_SOFA_BED },
      [fakeAdapter("ikea", [])],
    );
    assert.equal(result.candidates.length, 0);
    assert.equal(result.warnings.filter((w) => w.toLowerCase().includes("failed")).length, 0);
  });

  it("falls back to rawQuery search when quOutput is undefined", async () => {
    const products = [makeProduct({ itemNo: "013.001.01", name: "KIVIK Sofa" })];
    const result = await findProducts(
      { rawQuery: "sofa", quOutput: undefined },
      [fakeAdapter("ikea", products)],
    );
    assert.equal(result.searchQuery, "sofa");
    assert.equal(result.candidates.length, 1);
  });

  it("merges results from multiple adapters", async () => {
    const ikeaProducts = [makeProduct({ itemNo: "014.001.01", name: "IKEA Sofa Bed", retailer: "ikea" })];
    const structubeProducts = [makeProduct({ itemNo: "014.002.01", name: "Structube Sofa Bed", retailer: "structube" })];
    const result = await findProducts(
      { rawQuery: "sofa bed", quOutput: QU_SOFA_BED, retailerScope: "all" },
      [fakeAdapter("ikea", ikeaProducts), fakeAdapter("structube", structubeProducts)],
    );
    const retailers = new Set(result.candidates.map((c) => c.retailer));
    assert.ok(retailers.has("ikea"));
    assert.ok(retailers.has("structube"));
  });

  it("sorts candidates by matchScore descending", async () => {
    // Product with white color → score > product without
    const products = [
      makeProduct({ itemNo: "015.001.01", name: "MICKE Desk generic color" }),
      makeProduct({ itemNo: "015.001.02", name: "MICKE Desk white", designText: "white" }),
    ];
    const result = await findProducts(
      { rawQuery: "white desk", quOutput: QU_IKEA_DESK },
      [fakeAdapter("ikea", products)],
    );
    assert.ok(result.candidates[0].matchScore >= result.candidates[1].matchScore);
  });

  it("searchQuery reflects buildSearchQuery output", async () => {
    const result = await findProducts(
      { rawQuery: "raw query", quOutput: QU_SOFA_BED },
      [fakeAdapter("ikea", [])],
    );
    // Should use keywords, not raw query
    assert.notEqual(result.searchQuery, "raw query");
    assert.ok(result.searchQuery.includes("sofa bed"));
  });
});

// ── candidateToProductInfo ──

describe("candidateToProductInfo", () => {
  const candidate: ProductCandidate = {
    retailer: "ikea",
    productId: "111.222.33",
    variantId: "Oak",
    itemNo: "111.222.33",
    name: "LISABO Desk",
    typeName: "Desk",
    price: 299,
    currency: "CAD",
    url: "https://ikea.com/desk",
    imageUrl: "https://ikea.com/img.jpg",
    matchScore: 0.9,
    matchedFromKeywords: ["desk"],
    warnings: [],
    measureText: "140×65 cm",
    designText: "Oak",
  };

  it("maps all fields correctly", () => {
    const p = candidateToProductInfo(candidate);
    assert.equal(p.retailer, "ikea");
    assert.equal(p.itemNo, "111.222.33");
    assert.equal(p.name, "LISABO Desk");
    assert.equal(p.typeName, "Desk");
    assert.deepEqual(p.price, { amount: 299, currency: "CAD" });
    assert.equal(p.url, "https://ikea.com/desk");
    assert.equal(p.imageUrl, "https://ikea.com/img.jpg");
    assert.equal(p.measureText, "140×65 cm");
    assert.equal(p.designText, "Oak");
  });

  it("sets price to null when price field is null", () => {
    const p = candidateToProductInfo({ ...candidate, price: null });
    assert.equal(p.price, null);
  });

  it("sets price to null when currency is null", () => {
    const p = candidateToProductInfo({ ...candidate, currency: null });
    assert.equal(p.price, null);
  });

  it("falls back productId → itemNo when itemNo is null", () => {
    const p = candidateToProductInfo({ ...candidate, itemNo: null });
    assert.equal(p.itemNo, candidate.productId);
  });
});
