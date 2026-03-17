import type { RankedStore } from "../types";

function storeLabel(s: RankedStore): string {
  return s.store.label ?? s.store.storeId;
}

function storeDistance(s: RankedStore): string | null {
  if (s.distanceKm == null) return null;
  const km = s.distanceKm;
  if (km < 1) return "< 1 km";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function stockSummary(s: RankedStore): string {
  const total = s.itemDetails.length;
  if (total === 0) return "";
  const inStock = s.itemDetails.filter(d => d.sufficient).length;
  return `${inStock} of ${total} item${total > 1 ? "s" : ""} in stock`;
}

interface Props {
  ranked: RankedStore[];
  explanationPoints: string[];
}

export default function DecisionSummary({ ranked, explanationPoints }: Props) {
  const top = ranked[0];
  if (!top) return null;

  const dist  = storeDistance(top);
  const stock = stockSummary(top);

  const reasons: string[] = [];
  if (stock) reasons.push(stock);
  if (dist)  reasons.push(`${dist} away`);
  if (explanationPoints.length > 0 && reasons.length < 2) reasons.push(explanationPoints[0]);
  const reason = reasons.slice(0, 2).join(", ");

  const closest  = ranked.slice(1).reduce<RankedStore | null>((best, s) =>
    (s.distanceScore ?? 0) > ((best?.distanceScore) ?? 0) ? s : best, null);
  const cheapest = ranked.slice(1).reduce<RankedStore | null>((best, s) =>
    (s.priceScore ?? 0) > ((best?.priceScore) ?? 0) ? s : best, null);
  const runnerUp = ranked[1] ?? null;

  const showClosest  = closest  && closest  !== top && storeLabel(closest)  !== storeLabel(top);
  const showCheapest = cheapest && cheapest !== top && storeLabel(cheapest) !== storeLabel(top);

  return (
    <div className="decision-summary">
      <div className="decision-label">Best overall recommendation</div>
      <div className="decision-main">{storeLabel(top)}</div>
      {reason && <div className="decision-reason">{reason}.</div>}
      <div className="decision-alts">
        {showClosest && (
          <div className="decision-alt">
            <span className="decision-alt-label">Closest:</span>
            {storeLabel(closest!)}
          </div>
        )}
        {showCheapest && (
          <div className="decision-alt">
            <span className="decision-alt-label">Best price:</span>
            {storeLabel(cheapest!)}
          </div>
        )}
        {!showClosest && !showCheapest && runnerUp && (
          <div className="decision-alt">
            <span className="decision-alt-label">Runner-up:</span>
            {storeLabel(runnerUp)}
          </div>
        )}
      </div>
    </div>
  );
}
