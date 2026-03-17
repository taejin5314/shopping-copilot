import type { RankedStore } from "../types";

function storeLabel(s: RankedStore): string {
  return s.store.label ?? s.store.storeId;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n * 100) + "%";
}

function approxDist(s: RankedStore): string | null {
  if (s.distanceScore == null) return null;
  const km = Math.round((1 - s.distanceScore) * 150);
  return km < 5 ? "< 5 km" : `~${km} km`;
}

function stockInfo(s: RankedStore): { label: string; cls: string } {
  const total = s.itemDetails.length;
  if (total === 0) return { label: "—", cls: "" };
  const n = s.itemDetails.filter(d => d.sufficient).length;
  return {
    label: `${n}/${total} in stock`,
    cls: n === total ? "val-ok" : "val-partial",
  };
}

function buildWhy(s: RankedStore, pts: string[]): string[] {
  if (pts.length > 0) return pts.slice(0, 3);
  const out: string[] = [];
  const { label: sl, cls } = stockInfo(s);
  if (cls === "val-ok")      out.push(`Full stock coverage — ${sl}`);
  else if (sl !== "—")       out.push(`Partial stock — ${sl}`);
  if (s.convenienceScore > 0.6) out.push("Good pickup availability and convenience");
  const d = approxDist(s);
  if (d && (s.distanceScore ?? 0) > 0.6) out.push(`Close by — ${d}`);
  if ((s.priceScore ?? 0) > 0.7)         out.push("Competitive pricing");
  return out.slice(0, 3);
}

interface Props {
  store: RankedStore;
  rank: number;
  explanationPoints: string[];
}

export default function StoreRecommendationCard({ store, rank, explanationPoints }: Props) {
  const d = approxDist(store);
  const { label: sl, cls: stockCls } = stockInfo(store);
  const why = buildWhy(store, rank === 1 ? explanationPoints : []);
  const rankCls = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : "rank-n";

  const mapsUrl = store.store.coords
    ? `https://www.google.com/maps/search/?api=1&query=${store.store.coords.lat},${store.store.coords.lng}`
    : null;

  return (
    <div className={`store-card${rank === 1 ? " store-card--top" : ""}`}>
      <div className="store-card-header">
        <div className="store-card-rank-wrap">
          <div className={`store-rank-badge ${rankCls}`}>#{rank}</div>
        </div>
        <div className="store-card-meta">
          <div className="store-card-name">{storeLabel(store)}</div>
          <span className="store-retailer-badge">{store.store.retailer.toUpperCase()}</span>
        </div>
        <div className="store-card-score">{pct(store.totalScore)} match</div>
      </div>

      <div className="store-card-stats">
        {d && (
          <div className="store-stat">
            <div className="store-stat-label">Distance</div>
            <div className="store-stat-value">{d}</div>
          </div>
        )}
        <div className="store-stat">
          <div className="store-stat-label">Stock</div>
          <div className={`store-stat-value ${stockCls}`}>{sl}</div>
        </div>
        <div className="store-stat">
          <div className="store-stat-label">Pickup</div>
          <div className="store-stat-value">
            {store.convenienceScore > 0.6 ? "Today" : "Check store"}
          </div>
        </div>
        {store.priceScore != null && (
          <div className="store-stat">
            <div className="store-stat-label">Price</div>
            <div className="store-stat-value">
              {store.priceScore > 0.7 ? "$" : store.priceScore > 0.4 ? "$$" : "$$$"}
            </div>
          </div>
        )}
      </div>

      {why.length > 0 && (
        <div className="store-card-why">
          <div className="why-title">Why this store</div>
          {why.map((pt, i) => (
            <div key={i} className="why-point">
              <span className="why-arrow">→</span>
              <span>{pt}</span>
            </div>
          ))}
        </div>
      )}

      <div className="store-card-ctas">
        <button className="btn-secondary">View details</button>
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
            Get directions
          </a>
        )}
      </div>
    </div>
  );
}
