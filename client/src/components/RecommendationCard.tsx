import type { RankedStore } from "../types";

function storeLabel(s: RankedStore): string {
  return s.store.label ?? s.store.storeId;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n * 100) + "%";
}

function storeDistance(s: RankedStore): string | null {
  if (s.distanceScore == null) return null;
  const approxKm = Math.round((1 - s.distanceScore) * 150);
  return approxKm < 5 ? "< 5 km" : `~${approxKm} km`;
}

function stockInfo(s: RankedStore): { label: string; status: "good" | "ok" | "bad" } {
  const total = s.itemDetails.length;
  if (total === 0) return { label: "—", status: "ok" };
  const inStock = s.itemDetails.filter(d => d.sufficient).length;
  return {
    label: `${inStock}/${total} in stock`,
    status: inStock === total ? "good" : inStock > 0 ? "ok" : "bad",
  };
}

function buildWhyPoints(store: RankedStore, explanationPoints: string[]): string[] {
  if (explanationPoints.length > 0) return explanationPoints.slice(0, 3);

  const points: string[] = [];
  const { label, status } = stockInfo(store);
  if (status === "good") points.push(`High stock coverage — ${label}`);
  else if (status === "ok") points.push(`Partial stock — ${label}`);
  if (store.convenienceScore > 0.6) points.push("Good pickup availability and convenience");
  const dist = storeDistance(store);
  if (dist && store.distanceScore != null && store.distanceScore > 0.6) points.push(`Relatively close — ${dist}`);
  if (store.priceScore != null && store.priceScore > 0.7) points.push("Competitive pricing vs other options");
  return points.slice(0, 3);
}

interface Props {
  store: RankedStore;
  rank: number;
  explanationPoints: string[];
}

export default function RecommendationCard({ store, rank, explanationPoints }: Props) {
  const dist = storeDistance(store);
  const { label: stockLabel, status: stockStatus } = stockInfo(store);
  const whyPoints = buildWhyPoints(store, rank === 1 ? explanationPoints : []);

  const rankClass = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "rank-n";

  const mapsUrl = store.store.coords
    ? `https://www.google.com/maps/search/?api=1&query=${store.store.coords.lat},${store.store.coords.lng}`
    : null;

  return (
    <div className={`rec-card-v2${rank === 1 ? " rank-1" : ""}`}>
      <div className="rec-card-header">
        <div className="rec-card-header-left">
          <div className={`rank-badge ${rankClass}`}>#{rank}</div>
          <div className="rec-card-title-group">
            <div className="rec-card-store-name">{storeLabel(store)}</div>
            <div className="rec-card-retailer">{store.store.retailer.toUpperCase()}</div>
          </div>
        </div>
        <div className="rec-card-score-badge">{pct(store.totalScore)} match</div>
      </div>

      <div className="rec-card-stats">
        {dist && (
          <div className="rec-stat">
            <div className="rec-stat-label">Distance</div>
            <div className="rec-stat-value">{dist}</div>
          </div>
        )}
        <div className="rec-stat">
          <div className="rec-stat-label">Stock</div>
          <div className={`rec-stat-value ${stockStatus}`}>{stockLabel}</div>
        </div>
        <div className="rec-stat">
          <div className="rec-stat-label">Pickup</div>
          <div className="rec-stat-value ok">
            {store.convenienceScore > 0.6 ? "Available today" : "Check store"}
          </div>
        </div>
        {store.priceScore != null && (
          <div className="rec-stat">
            <div className="rec-stat-label">Price level</div>
            <div className="rec-stat-value">
              {store.priceScore > 0.7 ? "$" : store.priceScore > 0.4 ? "$$" : "$$$"}
            </div>
          </div>
        )}
      </div>

      {whyPoints.length > 0 && (
        <div className="why-section">
          <div className="why-label">Why this store</div>
          <div className="why-points">
            {whyPoints.map((pt, i) => (
              <div key={i} className="why-point">{pt}</div>
            ))}
          </div>
        </div>
      )}

      <div className="rec-card-ctas">
        <button className="cta-secondary">View details</button>
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="cta-primary">
            Get directions
          </a>
        )}
      </div>
    </div>
  );
}
