import { useRef, KeyboardEvent } from "react";

interface GeoState { status: "detecting" | "ok" | "denied"; lat: number | null; lng: number | null; }

interface Props {
  geo: GeoState;
  onRetryGeo: () => void;
  query: string;
  onQueryChange: (v: string) => void;
  retailer: string;
  onRetailerChange: (v: string) => void;
  radiusKm: number | null;
  onRadiusChange: (v: number | null) => void;
  loading: boolean;
  onSubmit: () => void;
}

const RADIUS_OPTIONS: { label: string; value: number | null }[] = [
  { label: "10 km", value: 10 },
  { label: "25 km", value: 25 },
  { label: "50 km", value: 50 },
  { label: "100 km", value: 100 },
  { label: "Any", value: null },
];

const RETAILER_OPTIONS = [
  { label: "Auto-detect", value: "" },
  { label: "IKEA", value: "ikea" },
  { label: "Structube", value: "structube" },
];

export default function SearchShell({
  geo, onRetryGeo,
  query, onQueryChange,
  retailer, onRetailerChange,
  radiusKm, onRadiusChange,
  loading, onSubmit,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const geoLabel = () => {
    if (geo.status === "detecting") return "Detecting location…";
    if (geo.status === "denied") return "Location unavailable";
    return `${geo.lat!.toFixed(4)},  ${geo.lng!.toFixed(4)}`;
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
  };

  return (
    <div className="search-card">
      {/* Location bar */}
      <div className="location-bar">
        <div className="location-status">
          <span className={`loc-dot ${geo.status}`} />
          {geo.status === "ok" && <span>📍</span>}
          <span>{geoLabel()}</span>
        </div>
        <button className="loc-retry" onClick={onRetryGeo} aria-label="Retry location">
          ↻ retry
        </button>
      </div>

      {/* Body */}
      <div className="search-body">
        <textarea
          ref={textareaRef}
          className="query-input"
          rows={2}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={'What are you looking for? e.g. "sofa bed under $800" or "KALLAX near me"'}
          disabled={loading}
        />

        <div className="search-controls">
          <div className="controls-left">
            {/* Radius */}
            <div>
              <div className="control-label">Search radius</div>
              <div className="radius-group">
                {RADIUS_OPTIONS.map(opt => (
                  <button
                    key={String(opt.value)}
                    className={`radius-btn${radiusKm === opt.value ? " active" : ""}`}
                    onClick={() => onRadiusChange(opt.value)}
                    disabled={geo.status !== "ok" && opt.value !== null}
                    title={geo.status !== "ok" && opt.value !== null ? "Allow location access to use radius" : undefined}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Retailer */}
            <div>
              <div className="control-label">Retailer</div>
              <div className="retailer-group">
                {RETAILER_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`retailer-btn${retailer === opt.value ? " active" : ""}`}
                    onClick={() => onRetailerChange(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            className="ask-btn"
            onClick={onSubmit}
            disabled={loading || !query.trim()}
          >
            {loading ? "Asking…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
