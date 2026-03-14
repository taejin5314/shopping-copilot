import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/domain/intent.js";

describe("classifyIntent", () => {
  // ── Stock intent ──

  it("detects stock intent from 'is this in stock'", () => {
    const r = classifyIntent("Is item 20522046 in stock at store #399?");
    assert.equal(r.type, "stock");
    assert.ok(r.itemNos.includes("20522046"));
    assert.ok(r.storeHints.includes("399"));
  });

  it("detects stock from 'which store has'", () => {
    const r = classifyIntent("Which store has the KALLAX shelf 005.221.32?");
    assert.equal(r.type, "stock");
    assert.ok(r.itemNos.includes("005.221.32"));
  });

  it("detects stock from availability question", () => {
    const r = classifyIntent("Can I buy 40522047 in Canada?");
    assert.equal(r.type, "stock");
    assert.ok(r.itemNos.includes("40522047"));
    assert.equal(r.countryCode, "CA");
  });

  // ── Policy intent ──

  it("detects policy intent from return question", () => {
    const r = classifyIntent("What is the return policy for IKEA furniture?");
    assert.equal(r.type, "policy");
  });

  it("detects policy from delivery question", () => {
    const r = classifyIntent("How long does IKEA delivery take?");
    assert.equal(r.type, "policy");
  });

  it("detects policy from assembly question", () => {
    const r = classifyIntent("Do I need special tools for assembly?");
    assert.equal(r.type, "policy");
  });

  // ── Recommendation intent ──

  it("detects recommendation intent", () => {
    const r = classifyIntent("Can you recommend a good bookshelf?");
    assert.equal(r.type, "recommendation");
  });

  it("detects recommendation from comparison", () => {
    const r = classifyIntent("Which one is better, KALLAX or BILLY?");
    assert.equal(r.type, "recommendation");
  });

  // ── Product info intent ──

  it("detects product_info intent", () => {
    const r = classifyIntent("How much does item 20522046 cost?");
    assert.equal(r.type, "product_info");
    assert.ok(r.itemNos.includes("20522046"));
  });

  // ── Unknown intent ──

  it("returns unknown for gibberish", () => {
    const r = classifyIntent("hello there");
    assert.equal(r.type, "unknown");
    assert.equal(r.confidence, 0);
  });

  // ── Mixed intents ──

  it("detects secondary intents", () => {
    const r = classifyIntent("Is 20522046 in stock and what is the return policy?");
    // Primary should be stock or policy
    assert.ok(r.type === "stock" || r.type === "policy");
    assert.ok(r.secondary.length > 0);
  });

  // ── Extraction ──

  it("extracts dotted item number", () => {
    const r = classifyIntent("Check stock for 005.221.32");
    assert.ok(r.itemNos.includes("005.221.32"));
  });

  it("extracts country code US", () => {
    const r = classifyIntent("Is it available in US?");
    assert.equal(r.countryCode, "US");
  });

  it("extracts country code from 'Canada'", () => {
    const r = classifyIntent("Is it available in Canada?");
    assert.equal(r.countryCode, "CA");
  });

  it("extracts store hint", () => {
    const r = classifyIntent("Check store #1129 for stock");
    assert.ok(r.storeHints.includes("1129"));
  });
});

describe("classifyIntent — non-English", () => {
  it("returns unknown for Korean query", () => {
    const r = classifyIntent("가장 저렴하지만 퀄리티 좋은 소파 침대 찾아줘");
    assert.equal(r.type, "unknown");
  });

  it("returns unknown for Japanese query", () => {
    const r = classifyIntent("カラックスの在庫を確認してください");
    assert.equal(r.type, "unknown");
  });

  it("still extracts item numbers from non-English queries", () => {
    const r = classifyIntent("30275861 재고 확인해줘");
    assert.ok(r.itemNos.includes("30275861"));
  });
});
