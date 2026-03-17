import HeroSearch from "./HeroSearch";
import PromptChips from "./PromptChips";
import SecondaryFilters from "./SecondaryFilters";
import HowItWorks from "./HowItWorks";

type GeoState = { status: "detecting" | "ok" | "denied"; lat: number | null; lng: number | null };

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  onExample: (q: string) => void;
  geo: GeoState;
  onRetryGeo: () => void;
  locationText: string;
  onLocationTextChange: (v: string) => void;
  retailer: string;
  onRetailerChange: (v: string) => void;
  radiusKm: number | null;
  onRadiusChange: (v: number | null) => void;
}

export default function EmptyState({
  query, onQueryChange, onSubmit, loading,
  onExample, geo, onRetryGeo,
  locationText, onLocationTextChange,
  retailer, onRetailerChange,
  radiusKm, onRadiusChange,
}: Props) {
  return (
    <div className="home-page">
      <nav className="home-nav">
        <div className="nav-logo">Shopilot</div>
        <button
          className="nav-how-link"
          onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
        >
          How it works
        </button>
      </nav>

      <main className="home-main">
        <HeroSearch
          query={query}
          onQueryChange={onQueryChange}
          onSubmit={onSubmit}
          loading={loading}
          geo={geo}
          onRetry={onRetryGeo}
          locationText={locationText}
          onLocationTextChange={onLocationTextChange}
        />
        <PromptChips onChipClick={onExample} />
        <SecondaryFilters
          retailer={retailer}
          onRetailerChange={onRetailerChange}
          radiusKm={radiusKm}
          onRadiusChange={onRadiusChange}
          geo={geo}
        />
      </main>

      <HowItWorks />
    </div>
  );
}
