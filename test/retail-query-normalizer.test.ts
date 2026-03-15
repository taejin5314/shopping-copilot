import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeForRetail } from "../src/domain/retail-query-normalizer.js";

// ──────────────────────────────────────────────
// normalizeForRetail — cross-language regression tests
// ──────────────────────────────────────────────

describe("normalizeForRetail — Korean ambiguous terms", () => {
  it("시계 → wall clock (not wristwatch)", () => {
    const r = normalizeForRetail("시계");
    assert.equal(r.normalizedQuery, "wall clock");
    assert.equal(r.confidence, "high");
    assert.equal(r.category, "decor");
    assert.ok(r.candidateTerms.includes("clock"), "fallback candidate includes clock");
  });

  it("매트 → rug (not exercise mat)", () => {
    const r = normalizeForRetail("매트");
    assert.equal(r.normalizedQuery, "rug");
    assert.equal(r.confidence, "high");
    assert.equal(r.category, "floor");
  });

  it("스탠드 → floor lamp (not display stand)", () => {
    const r = normalizeForRetail("스탠드");
    assert.equal(r.normalizedQuery, "floor lamp");
    assert.equal(r.confidence, "high");
    assert.equal(r.category, "lighting");
  });

  it("장 → cabinet (not generic 'long')", () => {
    const r = normalizeForRetail("장");
    assert.equal(r.normalizedQuery, "cabinet");
    assert.equal(r.confidence, "high");
    assert.equal(r.category, "storage");
  });

  it("선반 → shelf (not ladder/plank)", () => {
    const r = normalizeForRetail("선반");
    assert.equal(r.normalizedQuery, "shelf");
    assert.equal(r.confidence, "high");
    assert.equal(r.category, "storage");
  });
});

describe("normalizeForRetail — English ambiguous terms", () => {
  it("watch → wall clock (not wristwatch)", () => {
    const r = normalizeForRetail("watch");
    assert.equal(r.normalizedQuery, "wall clock");
    assert.equal(r.confidence, "high");
  });

  it("mat → rug (not exercise mat)", () => {
    const r = normalizeForRetail("mat");
    assert.equal(r.normalizedQuery, "rug");
    assert.equal(r.confidence, "high");
  });

  it("stand → floor lamp (not trade-show stand)", () => {
    const r = normalizeForRetail("stand");
    assert.equal(r.normalizedQuery, "floor lamp");
    assert.equal(r.confidence, "high");
  });

  it("console → console table (not gaming console)", () => {
    const r = normalizeForRetail("console");
    assert.equal(r.normalizedQuery, "console table");
    assert.equal(r.confidence, "high");
    assert.equal(r.category, "tables");
  });

  it("WATCH (uppercase) → wall clock — case-insensitive", () => {
    const r = normalizeForRetail("WATCH");
    assert.equal(r.normalizedQuery, "wall clock");
    assert.equal(r.confidence, "high");
  });
});

describe("normalizeForRetail — non-English, non-Korean terms", () => {
  it("armoire → wardrobe (French)", () => {
    const r = normalizeForRetail("armoire");
    assert.equal(r.normalizedQuery, "wardrobe");
    assert.equal(r.confidence, "high");
    assert.equal(r.category, "storage");
  });

  it("tapis → rug (French)", () => {
    const r = normalizeForRetail("tapis");
    assert.equal(r.normalizedQuery, "rug");
    assert.equal(r.confidence, "high");
  });
});

describe("normalizeForRetail — already-good English phrases", () => {
  it("sofa bed → passes through with medium confidence", () => {
    const r = normalizeForRetail("sofa bed");
    assert.equal(r.normalizedQuery, "sofa bed");
    assert.equal(r.confidence, "medium");
    assert.equal(r.category, null);
  });

  it("bookcase → passes through with medium confidence", () => {
    const r = normalizeForRetail("bookcase");
    assert.equal(r.normalizedQuery, "bookcase");
    assert.equal(r.confidence, "medium");
  });

  it("wall clock → passes through unchanged (already correct English)", () => {
    const r = normalizeForRetail("wall clock");
    assert.equal(r.normalizedQuery, "wall clock");
    assert.equal(r.confidence, "medium");
  });
});

describe("normalizeForRetail — compound queries", () => {
  it("원목 선반 → shelf (drops non-ASCII adjective 원목, maps 선반)", () => {
    const r = normalizeForRetail("원목 선반");
    assert.equal(r.normalizedQuery, "shelf");
    assert.equal(r.confidence, "medium"); // medium: non-ASCII was dropped
  });

  it("quality mat → rug (keeps ASCII adjective, maps mat)", () => {
    const r = normalizeForRetail("quality mat");
    assert.equal(r.normalizedQuery, "quality rug");
    assert.equal(r.confidence, "high"); // high: no non-ASCII dropped
  });

  it("120cm 선반 → 120cm shelf (keeps ASCII measurement, maps 선반)", () => {
    const r = normalizeForRetail("120cm 선반");
    assert.equal(r.normalizedQuery, "120cm shelf");
    // high: 선반 was resolved by the map (not dropped), 120cm is ASCII — no information lost
    assert.equal(r.confidence, "high");
  });
});

describe("normalizeForRetail — unknown non-English (low confidence)", () => {
  it("협탁 (nightstand — not in map) → low confidence, original preserved", () => {
    const r = normalizeForRetail("협탁");
    assert.equal(r.normalizedQuery, "협탁");
    assert.equal(r.confidence, "low");
    assert.equal(r.category, null);
  });

  it("unknown Japanese term → low confidence", () => {
    const r = normalizeForRetail("本棚");
    assert.equal(r.normalizedQuery, "本棚");
    assert.equal(r.confidence, "low");
  });
});

describe("normalizeForRetail — edge cases", () => {
  it("empty string → medium confidence (all-ASCII, no non-ASCII to worry about)", () => {
    const r = normalizeForRetail("");
    assert.equal(r.normalizedQuery, "");
    // medium: no non-ASCII present; schema validation prevents this from reaching search
    assert.equal(r.confidence, "medium");
  });

  it("whitespace-only → medium confidence after trim", () => {
    const r = normalizeForRetail("   ");
    assert.equal(r.confidence, "medium");
  });

  it("candidateTerms always contains at least the normalizedQuery", () => {
    for (const q of ["시계", "mat", "sofa bed", "협탁"]) {
      const r = normalizeForRetail(q);
      assert.ok(r.candidateTerms.length > 0, `candidateTerms not empty for "${q}"`);
      assert.ok(r.candidateTerms.includes(r.normalizedQuery), `candidateTerms contains normalizedQuery for "${q}"`);
    }
  });
});
