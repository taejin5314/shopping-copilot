interface Props {
  message: string | null;
  onRetry: () => void;
}

export default function ErrorRetry({ message, onRetry }: Props) {
  const isTimeout  = message?.toLowerCase().includes("timeout")  ?? false;
  const isOffline  = message?.toLowerCase().includes("network")   ?? false;
  const desc = isTimeout
    ? "The search took too long. This sometimes happens with large radius searches."
    : isOffline
    ? "It looks like you may be offline. Check your connection and try again."
    : "The search didn\u2019t complete correctly. It might be a temporary issue."

  return (
    <div className="error-state">
      <div className="error-icon">
        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="1.5" />
          <path d="M20 12v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="20" cy="28" r="1.25" fill="currentColor" />
        </svg>
      </div>
      <h3 className="error-title">That didn&apos;t work</h3>
      <p className="error-desc">{desc}</p>
      <button className="btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
