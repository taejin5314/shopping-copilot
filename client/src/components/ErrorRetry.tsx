interface Props {
  message: string | null;
  onRetry: () => void;
}

export default function ErrorRetry({ message, onRetry }: Props) {
  return (
    <div className="error-state">
      <div className="error-icon">
        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="1.5" />
          <path d="M20 12v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="20" cy="28" r="1.25" fill="currentColor" />
        </svg>
      </div>
      <h3 className="error-title">Something went wrong</h3>
      <p className="error-desc">
        {message ?? "An unexpected error occurred. Let's try again."}
      </p>
      <button className="btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
