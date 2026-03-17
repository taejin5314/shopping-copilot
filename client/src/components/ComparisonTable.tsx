import type { RankedStore } from "../types";

function storeLabel(s: RankedStore): string {
  return s.store.label ?? s.store.storeId;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n * 100) + "%";
}

function storeDistance(s: RankedStore): string {
  if (s.distanceScore == null) return "—";
  const approxKm = Math.round((1 - s.distanceScore) * 150);
  return approxKm < 5 ? "< 5 km" : `~${approxKm} km`;
}

function stockStr(s: RankedStore): { label: string; cls: string } {
  const total = s.itemDetails.length;
  if (total === 0) return { label: "—", cls: "" };
  const inStock = s.itemDetails.filter(d => d.sufficient).length;
  return {
    label: `${inStock}/${total}`,
    cls: inStock === total ? "comp-stock-ok" : "comp-stock-partial",
  };
}

interface Props { ranked: RankedStore[] }

export default function ComparisonTable({ ranked }: Props) {
  if (ranked.length < 2) return null;

  return (
    <div className="comparison-section">
      <div className="comparison-header-row">
        <div className="comparison-title">Store comparison</div>
      </div>
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Store</th>
            <th>Distance</th>
            <th>Stock</th>
            <th>Pickup</th>
            <th>Price</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((s, i) => {
            const { label: stockLabel, cls: stockCls } = stockStr(s);
            return (
              <tr key={`${s.store.retailer}-${s.store.storeId}`}>
                <td>
                  <span className="comp-store-name">
                    {i === 0 ? "★ " : ""}{storeLabel(s)}
                  </span>
                </td>
                <td>{storeDistance(s)}</td>
                <td className={stockCls}>{stockLabel}</td>
                <td>{s.convenienceScore > 0.6 ? "Today" : "Later"}</td>
                <td>
                  {s.priceScore != null
                    ? s.priceScore > 0.7 ? "$" : s.priceScore > 0.4 ? "$$" : "$$$"
                    : "—"}
                </td>
                <td className="comp-score">{pct(s.totalScore)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
