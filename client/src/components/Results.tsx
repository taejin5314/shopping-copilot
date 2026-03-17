import type { CopilotResponse, ProductInfo } from "../types";
import ResultSummary from "./ResultSummary";
import StoreRecommendationCard from "./StoreRecommendationCard";
import ComparisonTable from "./ComparisonTable";
import EmptyNoResults from "./EmptyNoResults";

interface Props {
  result: CopilotResponse;
  feedbackSent: boolean;
  onFeedback: (v: "thumbs_up" | "thumbs_down") => void;
  onProductClick: (itemNo: string, rank: number, retailer: string) => void;
  onNewSearch: () => void;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n * 100) + "%";
}

const DEFAULT_ASSUMPTIONS = [
  "Availability may change quickly — verify with the store before visiting.",
  "Distance is estimated from your current area and may vary.",
  "Some retailers may not expose live stock for every location.",
];

function ProductSection({
  products,
  onProductClick,
}: {
  products: ProductInfo[];
  onProductClick: (itemNo: string, rank: number, retailer: string) => void;
}) {
  if (products.length === 0) return null;
  return (
    <div className="product-section">
      <div className="section-header">
        <span className="section-title-sm">Matching products</span>
        <span className="section-count">{products.length} found</span>
      </div>
      {products.map((p, i) => {
        const variant   = [p.designText, p.measureText].filter(Boolean).join(" · ");
        const price     = p.price ? `${p.price.currency} ${p.price.amount}` : null;
        const Tag       = p.url ? "a" : "div";
        const linkProps = p.url ? { href: p.url, target: "_blank", rel: "noopener noreferrer" } : {};
        return (
          <Tag
            key={`${p.retailer}-${p.itemNo}`}
            className="product-item"
            {...linkProps}
            onClick={() => onProductClick(p.itemNo, i, p.retailer)}
          >
            {p.imageUrl
              ? <img className="product-img" src={p.imageUrl} alt={p.name} loading="lazy" />
              : <div className="product-img-placeholder">{p.retailer.slice(0,1).toUpperCase()}</div>
            }
            <div className="product-info">
              <div className="product-name">{p.name}</div>
              {variant && <div className="product-variant">{variant}</div>}
              <div className="product-meta">{p.retailer} · {p.itemNo}</div>
            </div>
            {price && <div className="product-price">{price}</div>}
            {p.url  && <span className="product-link-arrow">↗</span>}
          </Tag>
        );
      })}
    </div>
  );
}

export default function Results({ result, feedbackSent, onFeedback, onProductClick, onNewSearch }: Props) {
  const ranked            = result.recommendation?.ranked ?? [];
  const explanationPoints = result.recommendation?.explanationPoints ?? [];
  const allWarnings       = [...(result.warnings ?? []), ...(result.recommendation?.warnings ?? [])];
  const assumptions       = allWarnings.length > 0 ? allWarnings : DEFAULT_ASSUMPTIONS;

  const hasResults = ranked.length > 0 || (result.products?.length ?? 0) > 0;

  if (!hasResults) {
    return (
      <div className="results-body">
        <EmptyNoResults onRetry={onNewSearch} />
      </div>
    );
  }

  return (
    <div className="results-body">
      {/* Top recommendation banner */}
      {ranked.length > 0 && (
        <ResultSummary ranked={ranked} explanationPoints={explanationPoints} />
      )}

      {/* Ranked store cards */}
      {ranked.slice(0, 5).map((store, i) => (
        <StoreRecommendationCard
          key={`${store.store.retailer}-${store.store.storeId}`}
          store={store}
          rank={i + 1}
          explanationPoints={i === 0 ? explanationPoints : []}
        />
      ))}

      {/* Comparison table */}
      {ranked.length >= 2 && <ComparisonTable ranked={ranked} />}

      {/* Assumptions */}
      <details className="assumptions-section">
        <summary>
          Availability &amp; assumptions
          <span className="assumptions-arrow">▾</span>
        </summary>
        <div className="assumptions-body">
          {assumptions.map((w, i) => (
            <div key={i} className="assumption-item">
              <span className="assumption-icon">ℹ</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Products */}
      {(result.products?.length ?? 0) > 0 && (
        <ProductSection products={result.products} onProductClick={onProductClick} />
      )}

      {/* Answer / explanation */}
      {result.answer && (
        <div className="answer-panel">
          <span className="intent-badge">{result.intent?.type ?? "unknown"}</span>
          <p className="answer-text">{result.answer}</p>
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
      )}

      {/* Sources */}
      {(result.citations?.length ?? 0) > 0 && (
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

      {/* Policy knowledge */}
      {(result.retrievedKnowledge?.length ?? 0) > 0 && (
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

      {/* Tool calls */}
      {(result.toolCallsUsed?.length ?? 0) > 0 && (
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
                <span style={{ color: "var(--text-muted)", fontSize: ".68rem" }}>[{t.retailer}]</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
