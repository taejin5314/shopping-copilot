import { useState } from "react";

type GeoState = { status: "detecting" | "ok" | "denied"; lat: number | null; lng: number | null };

interface Props {
  retailer: string;
  onRetailerChange: (v: string) => void;
  radiusKm: number | null;
  onRadiusChange: (v: number | null) => void;
  geo: GeoState;
}

const RADIUS_OPTIONS: { label: string; value: number | null }[] = [
  { label: "10 km",  value: 10 },
  { label: "25 km",  value: 25 },
  { label: "50 km",  value: 50 },
  { label: "Any",    value: null },
];

const RETAILER_OPTIONS = [
  { label: "Any retailer", value: "" },
  { label: "IKEA",         value: "ikea" },
  { label: "Structube",    value: "structube" },
];

export default function SecondaryFilters({
  retailer, onRetailerChange,
  radiusKm, onRadiusChange,
  geo,
}: Props) {
  const [open, setOpen] = useState(false);
  const geoOk = geo.status === "ok";

  return (
    <div className="secondary-filters">
      <button
        className={`filters-toggle${open ? " open" : ""}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span>Filters</span>
        <span className="filters-toggle-icon">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="filters-panel">
          <div className="filter-group">
            <span className="filter-group-label">Search radius</span>
            <div className="filter-chips">
              {RADIUS_OPTIONS.map(opt => (
                <button
                  key={String(opt.value)}
                  className={`filter-chip${radiusKm === opt.value ? " active" : ""}`}
                  onClick={() => onRadiusChange(opt.value)}
                  disabled={!geoOk && opt.value !== null}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-group-label">Retailer</span>
            <div className="filter-chips">
              {RETAILER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`filter-chip${retailer === opt.value ? " active" : ""}`}
                  onClick={() => onRetailerChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
