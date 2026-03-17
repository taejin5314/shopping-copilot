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
  retailer: string;
  onRetailerChange: (v: string) => void;
  radiusKm: number | null;
  onRadiusChange: (v: number | null) => void;
}

export default function EmptyState({
  query, onQueryChange, onSubmit, loading,
  onExample, geo, onRetryGeo,
  retailer, onRetailerChange,
  radiusKm, onRadiusChange,
}: Props) {
  return (
    <div className="home-page">
      <nav className="home-nav">
        <div className="nav-logo">Shopilot</div>
        <a href="#how-it-works" className="nav-how-link">How it works</a>
      </nav>

      <main className="home-main">
        <HeroSearch
          query={query}
          onQueryChange={onQueryChange}
          onSubmit={onSubmit}
          loading={loading}
          geo={geo}
          onRetry={onRetryGeo}
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
