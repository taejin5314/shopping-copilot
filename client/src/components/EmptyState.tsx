const EXAMPLES = [
  "KALLAX shelf near me",
  "sofa bed under $800",
  "BILLY bookcase in stock nearby",
  "dining table at Structube",
  "bed frame queen size IKEA",
  "coffee table under $400",
];

export default function EmptyState({ onExample }: { onExample: (q: string) => void }) {
  return (
    <div className="empty-state">
      <div className="empty-headline">Find the right store,<br />before you go.</div>
      <p className="empty-sub">
        Search for any product and Shopilot will tell you<br />
        which nearby store has it in stock — and why.
      </p>
      <div className="examples-label">Try an example</div>
      <div className="example-pills">
        {EXAMPLES.map(ex => (
          <button key={ex} className="example-pill" onClick={() => onExample(ex)}>
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
