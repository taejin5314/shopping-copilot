import { useState, useEffect, useRef, useCallback } from "react";
import type { CopilotResponse, QueryRequest } from "./types";
import SearchShell from "./components/SearchShell";
import Results from "./components/Results";
import EmptyState from "./components/EmptyState";
import Skeleton from "./components/Skeleton";

// ── Session ID for event tracking ──
const SESSION_ID = crypto.randomUUID();

function trackEvent(eventType: string, extra: Record<string, unknown> = {}) {
  const payload = { event_type: eventType, session_id: SESSION_ID, ts: new Date().toISOString(), ...extra };
  try { navigator.sendBeacon("/events", new Blob([JSON.stringify(payload)], { type: "application/json" })); }
  catch { /* non-fatal */ }
}

// ── Geo hook ──
type GeoState = { status: "detecting" | "ok" | "denied"; lat: number | null; lng: number | null };

function useGeolocation() {
  const [geo, setGeo] = useState<GeoState>({ status: "detecting", lat: null, lng: null });

  const detect = useCallback(() => {
    setGeo(g => ({ ...g, status: "detecting" }));
    if (!navigator.geolocation) { setGeo({ status: "denied", lat: null, lng: null }); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setGeo({ status: "ok", lat: coords.latitude, lng: coords.longitude }),
      () => setGeo({ status: "denied", lat: null, lng: null }),
      { timeout: 8000 },
    );
  }, []);

  useEffect(() => { detect(); }, [detect]);
  return { geo, retry: detect };
}

// ── App ──
export default function App() {
  const { geo, retry: retryGeo } = useGeolocation();
  const [query, setQuery] = useState("");
  const [retailer, setRetailer] = useState("");        // "" = auto
  const [radiusKm, setRadiusKm] = useState<number | null>(25);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<CopilotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const lastQueryRef = useRef("");

  const submit = useCallback(async (q?: string) => {
    const finalQuery = (q ?? query).trim();
    if (!finalQuery) return;

    lastQueryRef.current = finalQuery;
    setStatus("loading");
    setError(null);
    setFeedbackSent(false);
    setResult(null);

    const body: QueryRequest = { query: finalQuery };
    if (retailer) body.retailer = retailer;
    if (geo.lat != null && geo.lng != null) {
      body.location = { lat: geo.lat, lng: geo.lng };
      if (radiusKm != null) body.radiusKm = radiusKm;
    }

    try {
      const res = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Session-Id": SESSION_ID },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const eb = await res.json().catch(() => null) as { message?: string } | null;
        throw new Error(eb?.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as CopilotResponse;
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStatus("error");
    }
  }, [query, retailer, radiusKm, geo]);

  const handleExampleClick = (example: string) => {
    setQuery(example);
    submit(example);
  };

  const handleFeedback = (value: "thumbs_up" | "thumbs_down") => {
    trackEvent("feedback_submitted", { feedback: value, query_text: lastQueryRef.current });
    setFeedbackSent(true);
  };

  const handleProductClick = (itemNo: string, rank: number, r: string) => {
    trackEvent("product_clicked", { item_no: itemNo, item_rank: rank, retailer: r, query_text: lastQueryRef.current });
  };

  return (
    <div className="page">
      {/* Header */}
      <header className="header">
        <div className="brand">Shopilot</div>
        <div className="tagline">Find the best nearby store before you go</div>
        <div className="retailer-badges">
          <span className="retailer-badge">IKEA</span>
          <span className="retailer-badge">Structube</span>
        </div>
      </header>

      {/* Search */}
      <SearchShell
        geo={geo}
        onRetryGeo={retryGeo}
        query={query}
        onQueryChange={setQuery}
        retailer={retailer}
        onRetailerChange={setRetailer}
        radiusKm={radiusKm}
        onRadiusChange={setRadiusKm}
        loading={status === "loading"}
        onSubmit={() => submit()}
      />

      {/* Error */}
      {status === "error" && error && (
        <div className="error-box">{error}</div>
      )}

      {/* Loading */}
      {status === "loading" && <Skeleton />}

      {/* Empty state */}
      {status === "idle" && (
        <EmptyState onExample={handleExampleClick} />
      )}

      {/* Results */}
      {status === "done" && result && (
        <Results
          result={result}
          feedbackSent={feedbackSent}
          onFeedback={handleFeedback}
          onProductClick={handleProductClick}
        />
      )}
    </div>
  );
}
