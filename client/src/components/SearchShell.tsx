import SecondaryFilters from "./SecondaryFilters";
import LocationStatus from "./LocationStatus";

type GeoState = { status: "detecting" | "ok" | "denied"; lat: number | null; lng: number | null };

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  geo: GeoState;
  onRetryGeo: () => void;
  locationText: string;
  onLocationTextChange: (v: string) => void;
  retailer: string;
  onRetailerChange: (v: string) => void;
  radiusKm: number | null;
  onRadiusChange: (v: number | null) => void;
  onLogoClick: () => void;
}

export default function SearchShell({
  query, onQueryChange, onSubmit, loading,
  geo, onRetryGeo, locationText, onLocationTextChange,
  retailer, onRetailerChange,
  radiusKm, onRadiusChange,
  onLogoClick,
}: Props) {
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
  };

  return (
    <div className="sticky-bar">
      <div className="sticky-bar-inner">
        <div className="sticky-bar-top">
          <button className="sticky-logo" onClick={onLogoClick} aria-label="Back to home">
            Shopilot
          </button>
          <div className="sticky-search-wrap">
            <input
              className="sticky-search-input"
              type="text"
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              onKeyDown={handleKey}
              disabled={loading}
              placeholder="Search products…"
            />
            <button
              className="sticky-search-btn"
              onClick={onSubmit}
              disabled={loading || !query.trim()}
            >
              {loading ? "…" : "Search"}
            </button>
          </div>
        </div>
        <div className="sticky-filters-wrap">
          <LocationStatus
            geo={geo}
            onRetryGeo={onRetryGeo}
            locationText={locationText}
            onLocationTextChange={onLocationTextChange}
          />
          <SecondaryFilters
            retailer={retailer}
            onRetailerChange={onRetailerChange}
            radiusKm={radiusKm}
            onRadiusChange={onRadiusChange}
            geo={geo}
          />
        </div>
      </div>
    </div>
  );
}
