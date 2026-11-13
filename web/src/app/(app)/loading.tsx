export default function Loading() {
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="live-dot live-dot--on" style={{ width: 8, height: 8 }} />
            Loading…
          </span>
          <h1 className="display">Opening field view</h1>
        </div>
      </header>
      <section className="panel">
        <div className="panel__body" style={{ padding: "40px var(--gutter)", color: "var(--muted)" }}>
          <p className="notice">Loading data from the field…</p>
        </div>
      </section>
    </div>
  );
}
