import { useState, useEffect } from "react";

const STEPS = [
  { msg: "Checking nearby retailers…",      sub: "Finding stores in your area" },
  { msg: "Looking up stock availability…",  sub: "Querying real-time inventory" },
  { msg: "Ranking the best options…",        sub: "Comparing stock, distance, and convenience" },
];

export default function LoadingSteps() {
  const [stepIdx, setStepIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (stepIdx >= STEPS.length - 1) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => {
        setStepIdx(i => i + 1);
        setVisible(true);
      }, 320);
    }, 2200);
    return () => clearTimeout(timer);
  }, [stepIdx]);

  const step = STEPS[stepIdx];

  return (
    <div className="loading-wrap">
      <div className="loading-steps">
        <div className="loading-progress-bar">
          <div className="loading-progress-fill" />
        </div>
        <div className="loading-step-msg" style={{ opacity: visible ? 1 : 0 }}>
          {step.msg}
        </div>
        <div className="loading-step-sub" style={{ opacity: visible ? 0.7 : 0 }}>
          {step.sub}
        </div>
      </div>

      <div className="skeleton-cards">
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton-card" style={{ opacity: 1 - (i - 1) * 0.22 }}>
            {i === 1 ? (
              <>
                <div className="sk sk-sub" style={{ width: "24%", marginBottom: "12px" }} />
                <div className="sk sk-title" />
                <div className="sk sk-sub" style={{ width: "38%" }} />
                <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div className="sk sk-bar" />
                  <div className="sk sk-bar" />
                  <div className="sk sk-bar" />
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[1, 2].map(j => (
                  <div key={j} style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <div className="sk" style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="sk sk-line" style={{ marginBottom: "6px" }} />
                      <div className="sk sk-line short" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
