const SAMPLE_CARDS = [
  {
    tag: "Best overall",
    tagClass: "best",
    store: "IKEA North York",
    retailer: "IKEA",
    stats: [
      { label: "Distance", value: "14 min drive" },
      { label: "Stock",    value: "4 of 5 items" },
      { label: "Pickup",   value: "Available today" },
    ],
    score: "92",
  },
  {
    tag: "Closest option",
    tagClass: "closest",
    store: "Structube Vaughan",
    retailer: "Structube",
    stats: [
      { label: "Distance", value: "11 min drive" },
      { label: "Stock",    value: "3 of 5 items" },
      { label: "Pickup",   value: "Tomorrow" },
    ],
    score: "84",
  },
  {
    tag: "Best price",
    tagClass: "price",
    store: "Walmart Downsview",
    retailer: "Walmart",
    stats: [
      { label: "Distance", value: "17 min drive" },
      { label: "Stock",    value: "5 of 5 items" },
      { label: "Pickup",   value: "Available today" },
    ],
    score: "81",
  },
];

export default function SampleResultsPreview() {
  return (
    <>
      <div className="sample-query-label">
        Example:{" "}
        <span className="sample-query-text">
          "Desk chair under $200 near downtown Toronto"
        </span>
      </div>
      <div className="sample-cards">
        {SAMPLE_CARDS.map(card => (
          <div key={card.tag} className="sample-card">
            <div className={`sample-card-tag ${card.tagClass}`}>{card.tag}</div>
            <div className="sample-card-store">{card.store}</div>
            <div className="sample-card-retailer">{card.retailer}</div>
            {card.stats.map(stat => (
              <div key={stat.label} className="sample-card-stat">
                <span className="stat-dot" />
                <span style={{ color: "var(--text-4)", marginRight: 3 }}>{stat.label}:</span>
                {stat.value}
              </div>
            ))}
            <div className="sample-score">Match score: {card.score}</div>
          </div>
        ))}
      </div>
    </>
  );
}
