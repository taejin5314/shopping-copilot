const STEPS = [
  {
    num: "01",
    title: "Tell us what you need",
    desc: "Type any product in plain language — add budget, style, or pickup needs.",
  },
  {
    num: "02",
    title: "We check nearby stores",
    desc: "Shopilot searches IKEA and Structube near you for live stock and availability.",
  },
  {
    num: "03",
    title: "We rank & explain the best option",
    desc: "Get a clear top pick with reasoning — stock, distance, and convenience.",
  },
];

export default function HowItWorks() {
  return (
    <section className="how-section" id="how-it-works">
      <div className="how-inner">
        <div className="how-label">How it works</div>
        <div className="how-steps">
          {STEPS.map(step => (
            <div key={step.num} className="how-step">
              <div className="how-step-num">{step.num}</div>
              <div className="how-step-title">{step.title}</div>
              <div className="how-step-desc">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
