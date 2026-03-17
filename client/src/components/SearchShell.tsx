interface GeoState { status: "detecting" | "ok" | "denied"; lat: number | null; lng: number | null; }

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  geo: GeoState;
  onRetryGeo: () => void;
  retailer: string;
  onRetailerChange: (v: string) => void;
  radiusKm: number | null;
  onRadiusChange: (v: number | null) => void;
  onLogoClick: () => void;
}

const RETAILER_OPTIONS = [
  { label: "All retailers", value: "" },
  { label: "IKEA",          value: "ikea" },
  { label: "Structube",     value: "structube" },
];

export default function SearchShell({
  query, onQueryChange, onSubmit, loading,
  retailer, onRetailerChange,
  onLogoClick,
}: Props) {
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
  };

  return (
    <div className="sticky-search">
      <div className="sticky-search-inner">
        <span
          className="sticky-logo"
          onClick={onLogoClick}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === "Enter" && onLogoClick()}
        >
          Shopilot
        </span>
        <div className="sticky-input-wrap">
          <input
            className="sticky-input"
            type="text"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search for a product or store…"
            disabled={loading}
          />
          <button
            className="sticky-search-btn"
            onClick={onSubmit}
            disabled={loading || !query.trim()}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </div>
      <div className="sticky-filter-chips">
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
  );
}
