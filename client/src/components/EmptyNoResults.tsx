interface Props {
  onRetry: () => void;
}

export default function EmptyNoResults({ onRetry }: Props) {
  return (
    <div className="empty-no-results">
      <div className="empty-icon">
        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="18" cy="18" r="11" stroke="currentColor" strokeWidth="1.5" />
          <path d="M26.5 26.5L34 34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M13 18h10M18 13v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="empty-title">No matching stores found</h3>
      <p className="empty-desc">
        We couldn't find nearby stores with this product right now. Try broadening your search,
        adjusting the radius, or searching for something slightly different.
      </p>
      <button className="btn-primary" onClick={onRetry}>
        Try a different search
      </button>
    </div>
  );
}
