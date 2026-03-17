import { useState, useEffect, useRef } from "react";

type GeoState = { status: "detecting" | "ok" | "denied"; lat: number | null; lng: number | null };

interface Props {
  geo: GeoState;
  onRetryGeo: () => void;
  locationText: string;
  onLocationTextChange: (v: string) => void;
}

export default function LocationStatus({ geo, onRetryGeo, locationText, onLocationTextChange }: Props) {
  const [showInput, setShowInput] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const hasManual = locationText.trim().length > 0;
  const geoOk     = geo.status === "ok";
  const geoFailed = geo.status === "denied";

  // Auto-open the text fallback the first time geolocation fails and no manual location is set.
  const prevStatus = useRef(geo.status);
  useEffect(() => {
    if (prevStatus.current !== "denied" && geo.status === "denied" && !hasManual) {
      setShowInput(true);
    }
    prevStatus.current = geo.status;
  }, [geo.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus text input when it appears.
  useEffect(() => {
    if (showInput) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showInput]);

  function openEdit() { setDraft(locationText); setShowInput(true); }
  function dismiss()  { setShowInput(false); }

  function apply() {
    onLocationTextChange(draft.trim());
    setShowInput(false);
  }

  function clearAndUseGeo() {
    onLocationTextChange("");
    setShowInput(false);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter")  apply();
    if (e.key === "Escape") dismiss();
  }

  // ── Detecting ──────────────────────────────────────────
  if (geo.status === "detecting") {
    return (
      <div className="location-status">
        <span className="loc-dot detecting" />
        <span className="location-text">Detecting location…</span>
      </div>
    );
  }

  // ── Text input row ─────────────────────────────────────
  if (showInput) {
    return (
      <div className="location-status-wrap">
        <div className="location-input-row">
          <span className="location-input-icon" aria-hidden>&#x1F4CD;</span>
          <input
            ref={inputRef}
            className="location-text-input"
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Toronto, ON or M2M 0C6"
          />
          <button className="location-apply-btn" onClick={apply} disabled={!draft.trim()}>Apply</button>
          {(geoOk || hasManual) && (
            <button className="location-cancel-btn" onClick={dismiss} aria-label="Cancel">✕</button>
          )}
        </div>
        <div className="location-hint">
          {geoOk    && <button className="location-hint-link" onClick={clearAndUseGeo}>Use GPS instead</button>}
          {geoFailed && <button className="location-hint-link" onClick={onRetryGeo}>Try GPS again</button>}
        </div>
      </div>
    );
  }

  // ── GPS active, no manual override ─────────────────────
  if (geoOk && !hasManual) {
    return (
      <div className="location-status">
        <span className="loc-dot ok" />
        <span className="location-text">Using your current location</span>
        <button className="location-change-btn" onClick={openEdit}>Change</button>
      </div>
    );
  }

  // ── Manual location active ──────────────────────────────
  if (hasManual) {
    return (
      <div className="location-status">
        <span className="loc-dot manual" />
        <span className="location-text">Using: <strong className="loc-name">{locationText}</strong></span>
        <button className="location-change-btn" onClick={openEdit}>Change</button>
        {geoOk    && <button className="location-retry" onClick={clearAndUseGeo}>Use GPS</button>}
        {geoFailed && <button className="location-retry" onClick={onRetryGeo}>Retry GPS</button>}
      </div>
    );
  }

  // ── GPS failed, no manual location ─────────────────────
  return (
    <div className="location-status">
      <span className="loc-dot denied" />
      <span className="location-text location-text--warn">Location unavailable</span>
      <button className="location-change-btn location-change-btn--action" onClick={openEdit}>Enter location</button>
      <button className="location-retry" onClick={onRetryGeo}>Retry GPS</button>
    </div>
  );
}
