import type { CopilotResponse, RankedStore, ProductInfo } from "../types";

interface Props {
  result: CopilotResponse;
  feedbackSent: boolean;
  onFeedback: (v: "thumbs_up" | "thumbs_down") => void;
  onProductClick: (itemNo: string, rank: number, retailer: string) => void;
}

// ── Helpers ──
function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n * 100) + "%";
}

function storeLabel(s: RankedStore): string {
  return s.store.label ?? s.store.storeId;
}

function storeDistance(s: RankedStore): string | null {
  if (s.distanceScore == null) return null;
  // Approximate km from score (score = 1 - km/maxKm, maxKm ~150)
  const approxKm = Math.round((1 - s.distanceScore) * 150);
  return approxKm < 5 ? "< 5 km" : `~${approxKm} km`;
}

function stockSummary(s: RankedStore): string {
  const total = s.itemDetails.length;
  if (total === 0) return "";
  const inStock = s.itemDetails.filter(d => d.sufficient).length;
  return `${inStock} of ${total} item${total > 1 ? "s" : ""} in stock`;
}

// ── Recommended store card ──
function RecommendedStoreCard({ store }: { store: RankedStore }) {
  const dist = storeDistance(store);
  const summary = stockSummary(store);
  const scores = [
    { name: "Stock coverage", value: store.stockCoverageScore },
    { name: "Convenience", value: store.convenienceScore },
    store.distanceScore != null ? { name: "Distance", value: store.distanceScore } : null,
    store.priceScore    != null ? { name: "Price",    value: store.priceScore    } : null,
  ].filter(Boolean) as { name: string; value: number }[];

  return (
    <div className="rec-card">
      <div className="rec-eyebrow">Best match</div>
      <div className="rec-store-name">{storeLabel(store)}</div>
      <div className="rec-meta">
        <span>{store.store.retailer.toUpperCase()}</span>
        {dist && <><span className="rec-meta-dot">·</span><span>{dist}</span></>}
        <span className="rec-meta-dot">·</span>
        <span>{pct(store.totalScore)} match</span>
      </div>

      <div className="rec-scores">
        {scores.map(sc => (
          <div className="score-row" key={sc.name}>
            <span className="score-name">{sc.name}</span>
            <div className="score-track">
              <div className="score-fill" style={{ width: pct(sc.value) }} />
            </div>
            <span className="score-pct">{pct(sc.value)}</span>
          </div>
        ))}
      </div>

      {summary && (
        <div className="rec-footer">
          <div className="rec-stock-summary">
            <strong>{stockSummary(store)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Store ranking list ──
function StoreList({ stores }: { stores: RankedStore[] }) {
  if (stores.length === 0) return null;
  return (
    <div>
      <div className="section-label">Store rankings</div>
      <div className="store-list">
        {stores.map((s, i) => {
          const inStock = s.itemDetails.filter(d => d.sufficient).length;
          const total   = s.itemDetails.length;
          const hasStock = total > 0;
          return (
            <div className="store-item" key={`${s.store.retailer}-${s.store.storeId}`}>
              <span className="store-rank-num">{i + 2}</span>
              <div className="store-item-info">
                <div className="store-item-name">{storeLabel(s)}</div>
                <div className="store-item-meta">
                  {s.store.retailer.toUpperCase()}
                  {storeDistance(s) && ` · ${storeDistance(s)}`}
                </div>
              </div>
              {hasStock && (
                <span className={`store-item-stock ${inStock === total ? "ok" : "bad"}`}>
                  {inStock}/{total} in stock
                </span>
              )}
              <span className="store-item-score">{pct(s.totalScore)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Product list ──
function ProductList({
  products,
  onProductClick,
}: {
  products: ProductInfo[];
  onProductClick: (itemNo: string, rank: number, retailer: string) => void;
}) {
  if (products.length === 0) return null;
  return (
    <div>
      <div className="section-label">Matching products</div>
      <div className="product-list">
        {products.map((p, i) => {
          const variant = [p.designText, p.measureText].filter(Boolean).join(" · ");
          const price   = p.price ? `${p.price.currency} ${p.price.amount}` : null;
          const Tag = p.url ? "a" : "div";
          const linkProps = p.url
            ? { href: p.url, target: "_blank", rel: "noopener noreferrer" }
            : {};

          return (
            <Tag
              key={`${p.retailer}-${p.itemNo}`}
              className="product-item"
              {...linkProps}
              onClick={() => onProductClick(p.itemNo, i, p.retailer)}
            >
              {p.imageUrl ? (
                <img className="product-img" src={p.imageUrl} alt={p.name} loading="lazy" />
              ) : (
                <div className="product-img-placeholder">{p.retailer.slice(0,1).toUpperCase()}</div>
              )}
              <div className="product-info">
                <div className="product-name">{p.name}</div>
                {variant && <div className="product-variant">{variant}</div>}
                <div className="product-meta">{p.retailer} · {p.itemNo}</div>
              </div>
              {price && <div className="product-price">{price}</div>}
              {p.url && <span className="product-link-arrow">↗</span>}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

// ── Answer panel ──
function AnswerPanel({
  intent, answer, feedbackSent, onFeedback,
}: {
  intent: string;
  answer: string;
  feedbackSent: boolean;
  onFeedback: (v: "thumbs_up" | "thumbs_down") => void;
}) {
  return (
    <div className="answer-panel">
      <span className="intent-badge">{intent}</span>
      <p className="answer-text">{answer}</p>
      <div className="feedback-bar">
        {feedbackSent ? (
          <span className="feedback-thanks">Thanks for the feedback</span>
        ) : (
          <>
            <span className="feedback-label">Was this helpful?</span>
            <button className="feedback-btn" onClick={() => onFeedback("thumbs_up")}>👍</button>
            <button className="feedback-btn" onClick={() => onFeedback("thumbs_down")}>👎</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Notices ──
function NoticesPanel({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="notices-panel">
      {warnings.map((w, i) => (
        <div className="notice-item" key={i}>
          <span className="notice-icon">⚠</span>
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Results ──
export default function Results({ result, feedbackSent, onFeedback, onProductClick }: Props) {
  const ranked     = result.recommendation?.ranked ?? [];
  const topStore   = ranked[0];
  const restStores = ranked.slice(1);
  const allWarnings = [
    ...(result.warnings ?? []),
    ...(result.recommendation?.warnings ?? []),
  ];

  return (
    <div className="results">
      {/* Recommended store — most important output */}
      {topStore && <RecommendedStoreCard store={topStore} />}

      {/* Other ranked stores */}
      {restStores.length > 0 && <StoreList stores={restStores} />}

      {/* Matched products */}
      {result.products?.length > 0 && (
        <ProductList products={result.products} onProductClick={onProductClick} />
      )}

      {/* Answer / explanation */}
      {result.answer && (
        <AnswerPanel
          intent={result.intent?.type ?? "unknown"}
          answer={result.answer}
          feedbackSent={feedbackSent}
          onFeedback={onFeedback}
        />
      )}

      {/* Notices */}
      <NoticesPanel warnings={allWarnings} />

      {/* Sources — collapsible, low emphasis */}
      {result.citations?.length > 0 && (
        <details className="collapsible">
          <summary>
            Sources ({result.citations.length})
            <span className="collapsible-arrow">▾</span>
          </summary>
          <div className="collapsible-body">
            {result.citations.map((c, i) => (
              <div className="citation-item" key={i}>
                <span className="citation-dot" />
                {c.url
                  ? <a href={c.url} target="_blank" rel="noopener">{c.label}</a>
                  : <span>{c.label}</span>
                }
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Policy knowledge — collapsible */}
      {result.retrievedKnowledge?.length > 0 && (
        <details className="collapsible">
          <summary>
            Policy information ({result.retrievedKnowledge.length})
            <span className="collapsible-arrow">▾</span>
          </summary>
          <div className="collapsible-body">
            {result.retrievedKnowledge.map((k, i) => (
              <div className="knowledge-item" key={i}>
                <div className="knowledge-head">
                  <span className="knowledge-title">{k.title}</span>
                  <span className="knowledge-score">{pct(k.score)}</span>
                </div>
                <div className="knowledge-body">{k.content}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Tool calls — collapsible, developer detail */}
      {result.toolCallsUsed?.length > 0 && (
        <details className="collapsible">
          <summary>
            Tool calls ({result.toolCallsUsed.length})
            <span className="collapsible-arrow">▾</span>
          </summary>
          <div className="collapsible-body">
            {result.toolCallsUsed.map((t, i) => (
              <div className="tool-row" key={i}>
                <span className="tool-name">{t.tool}</span>
                <span className={t.success ? "tool-ok" : "tool-fail"}>{t.success ? "✓" : "✗"}</span>
                <span className="tool-ms">{t.durationMs}ms</span>
                <span style={{ color: "var(--text-4)", fontSize: "0.7rem" }}>[{t.retailer}]</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
