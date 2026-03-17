interface Props {
  onRetry: () => void;
}

const SUGGESTIONS = [
  "Use a simpler product name, like \"desk\" instead of a full description",
  "Expand the search radius under Refine",
  "Remove a retailer filter to include more stores",
  "Enter your city or postal code to improve nearby results",
];

export default function EmptyNoResults({ onRetry }: Props) {
  return (
    <div className="empty-no-results">
      <div className="empty-icon">
        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="18" cy="18" r="11" stroke="currentColor" strokeWidth="1.5" />
          <path d="M26.5 26.5L34 34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M14 18h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="empty-title">Nothing found nearby</h3>
      <p className="empty-desc">
        We looked at nearby stores but couldn&apos;t find this item available right now.
      </p>
      <ul className="empty-suggestions">
        {SUGGESTIONS.map(s => (
          <li key={s} className="empty-suggestion-item">{s}</li>
        ))}
      </ul>
      <button className="btn-primary" onClick={onRetry}>
        Search again
      </button>
    </div>
  );
}
