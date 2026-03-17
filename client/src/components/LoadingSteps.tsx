import { useState, useEffect } from "react";

const STEPS = [
  "Checking nearby stores",
  "Looking up stock availability",
  "Ranking the best options",
];

export default function LoadingSteps() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (idx >= STEPS.length - 1) return;
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => { setIdx(i => i + 1); setVisible(true); }, 280);
    }, 2200);
    return () => clearTimeout(t);
  }, [idx]);

  return (
    <div className="loading-wrap">
      {/* Slim progress + status */}
      <div className="loading-status-bar">
        <div className="loading-progress-track">
          <div className="loading-progress-fill" />
        </div>
        <div
          className="loading-status-msg"
          style={{ opacity: visible ? 1 : 0, transition: "opacity .25s ease" }}
        >
          {STEPS[idx]}
        </div>
      </div>

      {/* ── Summary banner skeleton ── */}
      <div className="sk-banner">
        <div className="sk-b sk-b-xs mb-2" style={{ width: "22%" }} />
        <div className="sk-b sk-b-xl mb-3" style={{ width: "58%" }} />
        <div className="sk-chips-row mb-3">
          <div className="sk-b sk-b-pill" style={{ width: 64 }} />
          <div className="sk-b sk-b-pill" style={{ width: 80 }} />
          <div className="sk-b sk-b-pill" style={{ width: 70 }} />
        </div>
        <div className="sk-b sk-b-sm mb-1" style={{ width: "78%" }} />
        <div className="sk-b sk-b-sm mb-3" style={{ width: "52%" }} />
        <div className="sk-alts-row">
          <div className="sk-b sk-b-alt" style={{ width: 120 }} />
          <div className="sk-b sk-b-alt" style={{ width: 110 }} />
        </div>
      </div>

      {/* ── Top recommendation card skeleton ── */}
      <div className="skeleton-card skeleton-card--top-pick">
        {/* header: rank circle + name */}
        <div className="sk-card-header mb-3">
          <div className="sk sk-circle" />
          <div style={{ flex: 1 }}>
            <div className="sk sk-lg mb-1" style={{ width: "55%" }} />
            <div className="sk sk-sm" style={{ width: "22%", height: 12 }} />
          </div>
        </div>
        {/* stats band */}
        <div className="sk-stats-band mb-3">
          <div className="sk-stat-col">
            <div className="sk sk-xs mb-1" style={{ width: 36 }} />
            <div className="sk sk-sm" style={{ width: 56 }} />
          </div>
          <div className="sk-stat-col">
            <div className="sk sk-xs mb-1" style={{ width: 32 }} />
            <div className="sk sk-sm" style={{ width: 48 }} />
          </div>
        </div>
        {/* why this store */}
        <div className="sk sk-xs mb-2" style={{ width: "28%" }} />
        <div className="sk sk-sm mb-1" style={{ width: "86%" }} />
        <div className="sk sk-sm mb-1" style={{ width: "72%" }} />
        <div className="sk sk-sm mb-3" style={{ width: "60%" }} />
        {/* CTAs */}
        <div className="sk-cta-row">
          <div className="sk sk-cta" style={{ width: 108 }} />
          <div className="sk sk-cta sk-cta--primary" style={{ width: 120 }} />
        </div>
      </div>

      {/* ── Answer panel skeleton ── */}
      <div className="skeleton-card" style={{ opacity: .85 }}>
        <div className="sk sk-sm mb-2" style={{ width: "90%" }} />
        <div className="sk sk-sm mb-2" style={{ width: "78%" }} />
        <div className="sk sk-sm" style={{ width: "55%" }} />
      </div>

      {/* ── "Also consider" divider skeleton ── */}
      <div className="sk-section-divider">
        <div className="sk sk-xs" style={{ width: 80, flexShrink: 0 }} />
        <div className="sk-divider-line" />
      </div>

      {/* ── Alternative card skeletons ── */}
      {[0, 1].map(i => (
        <div key={i} className="skeleton-card" style={{ opacity: .7 - i * 0.18 }}>
          <div className="sk-card-header mb-2">
            <div className="sk sk-circle" />
            <div style={{ flex: 1 }}>
              <div className="sk sk-lg mb-1" style={{ width: "48%" }} />
              <div className="sk sk-sm" style={{ width: "18%", height: 12 }} />
            </div>
          </div>
          <div className="sk-stats-band">
            <div className="sk-stat-col">
              <div className="sk sk-xs mb-1" style={{ width: 36 }} />
              <div className="sk sk-sm" style={{ width: 52 }} />
            </div>
            <div className="sk-stat-col">
              <div className="sk sk-xs mb-1" style={{ width: 32 }} />
              <div className="sk sk-sm" style={{ width: 44 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
