import { useRef, KeyboardEvent } from "react";
import SampleResultsPreview from "./SampleResultsPreview";

interface GeoState { status: "detecting" | "ok" | "denied"; lat: number | null; lng: number | null; }

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  onExample: (q: string) => void;
  geo: GeoState;
}

const EXAMPLE_CHIPS = [
  "I need a white desk near North York",
  "Best store for a sofa available today",
  "Find a standing desk under $300 near me",
];

const TRUST_BADGES = ["Stock-aware", "Nearby-first", "Multi-retailer", "Fast results"];

const HOW_STEPS = [
  {
    num: "01",
    title: "Tell us what you need",
    body: "Type anything — product names, budgets, pickup needs. Natural language works great.",
  },
  {
    num: "02",
    title: "We check nearby retailers",
    body: "Shopilot searches IKEA and Structube stores near you for real-time stock and availability.",
  },
  {
    num: "03",
    title: "We rank the best options",
    body: "Get a clear recommendation with stock coverage, distance, and convenience all factored in.",
  },
];

export default function EmptyState({ query, onQueryChange, onSubmit, loading, onExample, geo }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
  };

  const geoStatus = geo.status === "ok" ? "active" : geo.status === "detecting" ? "detecting" : "";
  const geoHint =
    geo.status === "ok"        ? "Location detected — showing nearby results" :
    geo.status === "detecting" ? "Detecting your location…" :
                                 "Location unavailable — results may be less precise";

  return (
    <div className="home-page">
      {/* Nav */}
      <nav className="home-nav">
        <div className="nav-logo">Shopilot</div>
        <div className="nav-links">
          <a href="#how-it-works" className="nav-link">How it works</a>
          <button className="nav-signin">Try demo</button>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero-section">
        <div className="hero-eyebrow">Shopping copilot</div>
        <h1 className="hero-headline">
          Find the best nearby store<br />for what you need
        </h1>
        <p className="hero-subcopy">
          Compare stock, distance, and convenience across retailers in seconds.
        </p>

        <div className="hero-search-wrap">
          <div className="hero-input-row">
            <textarea
              ref={textareaRef}
              className="hero-textarea"
              rows={1}
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              onKeyDown={handleKey}
              placeholder='What are you looking for? e.g. "white desk near North York"'
              disabled={loading}
            />
            <button
              className="hero-submit-btn"
              onClick={onSubmit}
              disabled={loading || !query.trim()}
            >
              Search
            </button>
          </div>
          <div className="hero-geo-hint">
            <span className={`hero-geo-dot ${geoStatus}`} />
            {geoHint}
          </div>
        </div>

        <div className="hero-chips">
          {EXAMPLE_CHIPS.map(chip => (
            <button key={chip} className="hero-chip" onClick={() => onExample(chip)}>
              {chip}
            </button>
          ))}
        </div>

        <div className="trust-row">
          {TRUST_BADGES.map((badge, i) => (
            <>
              {i > 0 && <span key={`sep-${i}`} className="trust-sep">·</span>}
              <span key={badge} className="trust-badge">{badge}</span>
            </>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="how-section" id="how-it-works">
        <div className="how-inner">
          <div className="section-eyebrow">Simple process</div>
          <div className="section-title">How it works</div>
          <div className="how-steps">
            {HOW_STEPS.map(step => (
              <div key={step.num} className="how-step">
                <div className="how-step-num">{step.num}</div>
                <div className="how-step-title">{step.title}</div>
                <div className="how-step-body">{step.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sample results */}
      <section className="sample-section">
        <div className="section-eyebrow">See what results look like</div>
        <div className="section-title">Example results</div>
        <SampleResultsPreview />
      </section>
    </div>
  );
}
