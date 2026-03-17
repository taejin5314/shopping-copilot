import type { CopilotResponse, ProductInfo, RankedStore } from "../types";
import ResultSummary from "./ResultSummary";
import StoreRecommendationCard from "./StoreRecommendationCard";
import ComparisonTable from "./ComparisonTable";
import EmptyNoResults from "./EmptyNoResults";
import AnswerMarkdown from "./AnswerMarkdown";

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

// ── Contextual notice for partial/weak results ───────────────────────────────
interface NoticeInfo { icon: string; text: string; hint: string }

function buildNotice(result: CopilotResponse, ranked: RankedStore[]): NoticeInfo | null {
  if (ranked.length === 0) return null;

  const top = ranked[0];

  // Partial stock: top store is missing some of the requested items
  if (top.itemDetails.length > 1) {
    const covered = top.itemDetails.filter(d => d.sufficient).length;
    if (covered < top.itemDetails.length) {
      return {
        icon: "◑",
        text: `The best options we found cover ${covered} of ${top.itemDetails.length} items.`,
        hint: "Some items may need to be sourced separately or checked directly in-store.",
      };
    }
  }

  // No location — distance-aware ranking unavailable
  if (ranked.every(r => r.distanceKm == null)) {
    return {
      icon: "◎",
      text: "Results shown without a specific location.",
      hint: "Add your city or postal code under the search bar for more relevant nearby options.",
    };
  }

  // Single-retailer coverage only (when multiple are expected)
  const retailers = new Set(ranked.map(r => r.store.retailer));
  if (retailers.size === 1 && ranked.length >= 2) {
    const name = [...retailers][0].toUpperCase();
    return {
      icon: "▣",
      text: `All results are from ${name}.`,
      hint: "Remove a retailer filter to compare options from other stores.",
    };
  }

  return null;
}

export default function Results({ result, feedbackSent, onFeedback, onProductClick, onNewSearch }: Props) {
  const ranked            = result.recommendation?.ranked ?? [];
  const explanationPoints = result.recommendation?.explanationPoints ?? [];
  const allWarnings       = [...(result.warnings ?? []), ...(result.recommendation?.warnings ?? [])];
  const assumptions       = allWarnings.length > 0 ? allWarnings : DEFAULT_ASSUMPTIONS;
  const notice            = buildNotice(result, ranked);

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

      {/* Top recommendation card */}
      {ranked.length > 0 && (
        <StoreRecommendationCard
          key={`${ranked[0].store.retailer}-${ranked[0].store.storeId}`}
          store={ranked[0]}
          rank={1}
          explanationPoints={explanationPoints}
          products={result.products ?? []}
        />
      )}

      {/* Answer — positioned to support the top recommendation context */}
      {result.answer && (
        <div className="answer-panel">
          <AnswerMarkdown>{result.answer}</AnswerMarkdown>
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

      {/* Alternative stores */}
      {ranked.length > 1 && (
        <>
          <div className="results-section-divider">
            <span className="results-section-label">Also consider</span>
          </div>
          {ranked.slice(1, 5).map((store, i) => (
            <StoreRecommendationCard
              key={`${store.store.retailer}-${store.store.storeId}`}
              store={store}
              rank={i + 2}
              explanationPoints={[]}
              products={result.products ?? []}
            />
          ))}
        </>
      )}

      {/* Comparison table */}
      {ranked.length >= 2 && <ComparisonTable ranked={ranked} />}

      {/* Contextual notice for partial/weak/single-retailer results */}
      {notice && (
        <div className="state-notice">
          <span className="state-notice-icon" aria-hidden>{notice.icon}</span>
          <div className="state-notice-body">
            <span className="state-notice-text">{notice.text}</span>
            {" "}
            <span className="state-notice-hint">{notice.hint}</span>
          </div>
        </div>
      )}

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
