export default function Skeleton() {
  return (
    <div className="skeleton-wrap">
      {/* Recommended store skeleton */}
      <div className="skeleton-card">
        <div className="sk sk-sub" style={{ width: "30%", marginBottom: "12px" }} />
        <div className="sk sk-title" />
        <div className="sk sk-sub" style={{ width: "45%" }} />
        <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="sk sk-bar" />
          <div className="sk sk-bar" />
          <div className="sk sk-bar" />
        </div>
      </div>

      {/* Store list skeleton */}
      <div className="skeleton-card" style={{ padding: "0" }}>
        {[1, 2].map(i => (
          <div key={i} style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", gap: "14px", alignItems: "center" }}>
            <div className="sk" style={{ width: 20, height: 20, borderRadius: "50%" }} />
            <div style={{ flex: 1 }}>
              <div className="sk sk-line" style={{ marginBottom: "6px" }} />
              <div className="sk sk-line short" />
            </div>
            <div className="sk" style={{ width: 44, height: 22, borderRadius: "6px" }} />
          </div>
        ))}
      </div>

      {/* Products skeleton */}
      <div className="skeleton-card" style={{ padding: "0" }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ padding: "13px 18px", borderBottom: "1px solid var(--border)", display: "flex", gap: "14px", alignItems: "center" }}>
            <div className="sk" style={{ width: 44, height: 44, borderRadius: "6px", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="sk sk-line" style={{ marginBottom: "5px" }} />
              <div className="sk sk-line short" />
            </div>
            <div className="sk" style={{ width: 56, height: 16, borderRadius: "4px" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
