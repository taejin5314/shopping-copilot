import { useState, useEffect, useRef, useCallback } from "react";
import type { CopilotResponse, QueryRequest } from "./types";
import SearchShell from "./components/SearchShell";
import Results from "./components/Results";
import EmptyState from "./components/EmptyState";
import LoadingSteps from "./components/LoadingSteps";
import ErrorRetry from "./components/ErrorRetry";

// ── Session ID ──
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
  const [query, setQuery]       = useState("");
  const [retailer, setRetailer] = useState("");
  const [radiusKm, setRadiusKm] = useState<number | null>(25);
  const [locationText, setLocationText] = useState("");
  const [status, setStatus]     = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult]     = useState<CopilotResponse | null>(null);
  const [error, setError]       = useState<string | null>(null);
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
    // Prefer browser GPS; fall back to manually entered locationText.
    if (geo.lat != null && geo.lng != null && !locationText.trim()) {
      body.location = { lat: geo.lat, lng: geo.lng };
      if (radiusKm != null) body.radiusKm = radiusKm;
    } else if (locationText.trim()) {
      body.locationText = locationText.trim();
    } else if (geo.lat != null && geo.lng != null) {
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
  }, [query, retailer, radiusKm, locationText, geo]);

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

  const handleLogoClick = () => {
    setStatus("idle");
    setResult(null);
    setError(null);
  };

  // ── Home ──
  if (status === "idle") {
    return (
      <EmptyState
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => submit()}
        loading={false}
        onExample={handleExampleClick}
        geo={geo}
        onRetryGeo={retryGeo}
        locationText={locationText}
        onLocationTextChange={setLocationText}
        retailer={retailer}
        onRetailerChange={setRetailer}
        radiusKm={radiusKm}
        onRadiusChange={setRadiusKm}
      />
    );
  }

  // ── Results / loading / error ──
  return (
    <div className="results-page">
      <SearchShell
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => submit()}
        loading={status === "loading"}
        geo={geo}
        onRetryGeo={retryGeo}
        locationText={locationText}
        onLocationTextChange={setLocationText}
        retailer={retailer}
        onRetailerChange={setRetailer}
        radiusKm={radiusKm}
        onRadiusChange={setRadiusKm}
        onLogoClick={handleLogoClick}
      />

      {status === "loading" && <LoadingSteps />}

      {status === "error" && (
        <ErrorRetry message={error} onRetry={() => submit()} />
      )}

      {status === "done" && result && (
        <Results
          result={result}
          feedbackSent={feedbackSent}
          onFeedback={handleFeedback}
          onProductClick={handleProductClick}
          onNewSearch={handleLogoClick}
        />
      )}
    </div>
  );
}
