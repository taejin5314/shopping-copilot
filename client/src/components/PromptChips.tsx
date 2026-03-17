const CHIPS = [
  "White desk near North York",
  "Sofa available today in Toronto",
  "Standing desk under $300 nearby",
];

interface Props {
  onChipClick: (query: string) => void;
}

export default function PromptChips({ onChipClick }: Props) {
  return (
    <div className="prompt-chips">
      <span className="chips-label">Try an example</span>
      <div className="chips-row">
        {CHIPS.map(chip => (
          <button key={chip} className="prompt-chip" onClick={() => onChipClick(chip)}>
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
