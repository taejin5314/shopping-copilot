type GeoState = { status: "detecting" | "ok" | "denied"; lat: number | null; lng: number | null };

interface Props {
  geo: GeoState;
  onRetry: () => void;
}

export default function LocationStatus({ geo, onRetry }: Props) {
  const text =
    geo.status === "ok"        ? "Location ready" :
    geo.status === "detecting" ? "Detecting location…" :
                                 "Location unavailable — results may vary";

  return (
    <div className="location-status">
      <span className={`loc-dot ${geo.status}`} />
      <span className="location-text">{text}</span>
      {geo.status === "denied" && (
        <button className="location-retry" onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}
