import { useRef, KeyboardEvent } from "react";
import LocationStatus from "./LocationStatus";

type GeoState = { status: "detecting" | "ok" | "denied"; lat: number | null; lng: number | null };

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  geo: GeoState;
  onRetry: () => void;
  locationText: string;
  onLocationTextChange: (v: string) => void;
}

export default function HeroSearch({ query, onQueryChange, onSubmit, loading, geo, onRetry, locationText, onLocationTextChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
  };

  return (
    <div className="hero-search">
      <div className="hero-eyebrow">Shopping copilot</div>
      <h1 className="hero-headline">
        Find the best nearby store<br />for what you need
      </h1>
      <p className="hero-subcopy">
        Compare stock, distance, and convenience across retailers — in seconds.
      </p>

      <div className="search-input-wrapper">
        <div className="search-input-row">
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder='Try "white desk near North York" or "sofa available today"'
            disabled={loading}
            autoFocus
            aria-label="Search for a product"
          />
          <button
            className="search-submit-btn"
            onClick={onSubmit}
            disabled={loading || !query.trim()}
          >
            Find stores
          </button>
        </div>
        <LocationStatus
          geo={geo}
          onRetryGeo={onRetry}
          locationText={locationText}
          onLocationTextChange={onLocationTextChange}
        />
      </div>
    </div>
  );
}
