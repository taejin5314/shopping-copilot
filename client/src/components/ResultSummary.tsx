import type { RankedStore } from "../types";

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

function stockTag(s: RankedStore): string {
  const total = s.itemDetails.length;
  if (total === 0) return "";
  const n = s.itemDetails.filter(d => d.sufficient).length;
  if (total === 1) {
    const d = s.itemDetails[0];
    if (d.available != null) return d.available > 0 ? `${d.available} in stock` : "";
    return n === 1 ? "Full stock" : "";
  }
  return n === total ? "Full stock" : `${n}/${total} items`;
}

interface Props {
  ranked: RankedStore[];
  explanationPoints: string[];
}

export default function ResultSummary({ ranked, explanationPoints }: Props) {
  const top = ranked[0];
  if (!top) return null;

  const tags: string[] = [];
  const d = approxDist(top);
  const s = stockTag(top);
  if (d) tags.push(d);
  if (s) tags.push(s);
  if (top.convenienceScore > 0.6) tags.push("Pickup today");
  const displayTags = tags.slice(0, 3);

  // First explanation point shown as a dedicated "why" line, not as a tag
  const whyText = explanationPoints[0] ?? null;

  const rest = ranked.slice(1);
  const closest  = rest.find(r => (r.distanceScore ?? 0) > (top.distanceScore ?? 0));
  const cheapest = rest.find(r => (r.priceScore ?? 0) > (top.priceScore ?? 0));
  const runnerUp = rest[0] ?? null;

  const showClosest  = closest  && storeLabel(closest)  !== storeLabel(top);
  const showCheapest = cheapest && storeLabel(cheapest) !== storeLabel(top);

  return (
    <div className="result-summary">
      <div className="result-summary-label">Best overall</div>
      <div className="result-summary-store">{storeLabel(top)}</div>

      {displayTags.length > 0 && (
        <div className="result-summary-tags">
          {displayTags.map((tag, i) => (
            <span key={i} className="result-summary-tag">{tag}</span>
          ))}
        </div>
      )}

      {whyText && (
        <div className="result-summary-why">{whyText}</div>
      )}

      {(showClosest || showCheapest || runnerUp) && (
        <div className="result-summary-alts">
          {showClosest && (
            <div className="result-alt-pill">
              <span className="alt-label">Closest option</span>
              <span className="alt-store">{storeLabel(closest!)}</span>
            </div>
          )}
          {showCheapest && (
            <div className="result-alt-pill">
              <span className="alt-label">Best priced</span>
              <span className="alt-store">{storeLabel(cheapest!)}</span>
            </div>
          )}
          {!showClosest && !showCheapest && runnerUp && (
            <div className="result-alt-pill">
              <span className="alt-label">Runner-up</span>
              <span className="alt-store">{storeLabel(runnerUp)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
