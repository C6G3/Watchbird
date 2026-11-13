import { cap } from "@/lib/format";
import type { Insight } from "@/lib/types";

const CONDITION: Record<Insight["condition"], string> = {
  healthy: "tag--ok",
  stressed: "tag--warn",
  diseased: "tag--alert",
  pest: "tag--alert",
  injured: "tag--alert",
  unknown: "",
};
const URGENCY: Record<Insight["urgency"], string> = { low: "tag--ok", medium: "tag--warn", high: "tag--alert" };

export default function InsightView({ insight, compact }: { insight: Insight; compact?: boolean }) {
  return (
    <div className="insight">
      <div className="insight__head">
        <span className={`tag ${CONDITION[insight.condition]}`}>{cap(insight.condition)}</span>
        <span className={`tag ${URGENCY[insight.urgency]}`}>{cap(insight.urgency)} urgency</span>
      </div>
      {compact ? null : <h2 className="display">{insight.title}</h2>}
      <p className="insight__summary">{insight.summary}</p>

      {insight.actions.length ? (
        <div>
          <span className="label">What to do</span>
          <ol className="steps">
            {insight.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {insight.findings.length ? (
        <div>
          <span className="label">What the model saw</span>
          <ul className="bullets">
            {insight.findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 6 }}>
        <span className="label">Confidence · {Math.round(insight.confidence * 100)}%</span>
        <div className="meter" aria-hidden="true">
          <i style={{ width: `${insight.confidence * 100}%` }} />
        </div>
      </div>

      {insight.classifier?.length ? (
        <dl className="spec">
          {insight.classifier.map((c) => (
            <div key={c.label}>
              <dt>Classifier</dt>
              <dd>
                {c.label} <span className="muted num">· {Math.round(c.score * 100)}%</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="label">Model guidance, not a diagnosis. For serious cases call your extension officer or vet.</p>
    </div>
  );
}
