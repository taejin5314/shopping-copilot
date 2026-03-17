import { useState } from "react";
import type { RankedStore } from "../types";

/** "149 (North York, ON, CA)" → "IKEA North York", otherwise returns label as-is. */
function formatStoreName(label: string, retailer: string): string {
  const m = label.match(/^\d+\s*\(([^,]+)/);
  if (m) return `${retailer.toUpperCase()} ${m[1].trim()}`;
  return label;
}

function storeLabel(s: RankedStore): string {
  const raw = s.store.label ?? s.store.storeId;
  return formatStoreName(raw, s.store.retailer);
}

function approxDist(s: RankedStore): string | null {
  if (s.distanceKm == null) return null;
  const km = s.distanceKm;
  if (km < 1) return "< 1 km";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function stockInfo(s: RankedStore): { label: string; cls: string } {
  const total = s.itemDetails.length;
  if (total === 0) return { label: "—", cls: "" };
  const n = s.itemDetails.filter(d => d.sufficient).length;
  // Single item: show actual quantity ("8 in stock"), not coverage ratio
  if (total === 1) {
    const d = s.itemDetails[0];
    const label = d.available != null
      ? `${d.available} in stock`
      : d.sufficient ? "In stock" : "Out of stock";
    return { label, cls: d.sufficient ? "val-ok" : "val-partial" };
  }
  // Multiple items: show coverage count
  return {
    label: `${n}/${total} items`,
    cls: n === total ? "val-ok" : "val-partial",
  };
}

function buildWhy(s: RankedStore, pts: string[]): string[] {
  if (pts.length > 0) return pts.slice(0, 3);
  const out: string[] = [];
  const { label: sl, cls } = stockInfo(s);
  if (cls === "val-ok")  out.push(sl !== "—" ? sl : "All items in stock");
  else if (sl !== "—")   out.push(`${sl} available`);
  const d = approxDist(s);
  if (d) out.push(`About ${d} away`);
  if ((s.priceScore ?? 0) > 0.7) out.push("Competitive pricing");
  return out.slice(0, 3);
}

interface Props {
  store: RankedStore;
  rank: number;
  explanationPoints: string[];
}

export default function StoreRecommendationCard({ store, rank, explanationPoints }: Props) {
  const [expanded, setExpanded] = useState(false);
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
              <span className="why-check">✓</span>
              <span>{pt}</span>
            </div>
          ))}
        </div>
      )}

      <div className="store-card-ctas">
        {store.itemDetails.length > 0 && (
          <button className="btn-secondary" onClick={() => setExpanded(e => !e)}>
            {expanded ? "Hide details" : "View details"}
          </button>
        )}
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
            Get directions
          </a>
        )}
      </div>

      {expanded && store.itemDetails.length > 0 && (
        <div className="store-item-details">
          {store.itemDetails.map(d => (
            <div key={d.itemNo} className="store-item-row">
              <span className="store-item-no">{d.itemNo}</span>
              <span className={`store-item-stock ${d.sufficient ? "val-ok" : "val-partial"}`}>
                {d.available != null ? `${d.available} in stock` : "Unknown"}
              </span>
              <span className="store-item-needed">need {d.requested}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
