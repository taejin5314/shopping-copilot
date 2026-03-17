import { useState, useEffect } from "react";

const STEPS = [
  { msg: "Checking nearby retailers…",   sub: "Finding stores in your area" },
  { msg: "Looking up inventory…",         sub: "Checking real-time stock levels" },
  { msg: "Ranking the best options…",     sub: "Comparing stock, distance, and convenience" },
];

export default function LoadingSteps() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (idx >= STEPS.length - 1) return;
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => { setIdx(i => i + 1); setVisible(true); }, 320);
    }, 2000);
    return () => clearTimeout(t);
  }, [idx]);

  return (
    <div className="loading-wrap">
      <div className="loading-progress-bar">
        <div className="loading-progress-fill" />
      </div>

      <div
        className="loading-message"
        style={{ opacity: visible ? 1 : 0, transition: "opacity .3s ease" }}
      >
        <div className="loading-msg-main">{STEPS[idx].msg}</div>
        <div className="loading-msg-sub">{STEPS[idx].sub}</div>
      </div>

      <div className="loading-skeletons">
        {[0, 1, 2].map(i => (
          <div key={i} className="skeleton-card" style={{ opacity: 1 - i * 0.22 }}>
            {i === 0 ? (
              <>
                <div className="sk sk-sm mb-3" style={{ width: "28%" }} />
                <div className="sk sk-lg mb-2" />
                <div className="sk sk-sm mb-4" style={{ width: "42%" }} />
                <div className="sk sk-xs mb-2" />
                <div className="sk sk-xs mb-2" />
                <div className="sk sk-xs" style={{ width: "68%" }} />
              </>
            ) : (
              <div className="sk-row-list">
                {[0, 1].map(j => (
                  <div key={j} className="sk-row">
                    <div className="sk-circle" />
                    <div className="sk-row-content">
                      <div className="sk sk-sm mb-1" style={{ width: "52%" }} />
                      <div className="sk sk-xs" style={{ width: "32%" }} />
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
