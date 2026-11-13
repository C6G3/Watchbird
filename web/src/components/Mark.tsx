/** Logo mark: a GPS track ending in a fix, drawn like a survey symbol. */
export default function Mark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M2.5 19.5 8 13l4.5 3.5L18 8" strokeLinejoin="round" />
      <rect x="16" y="3" width="6" height="6" />
      <path d="M2 2v4M2 2h4" strokeWidth="1.2" />
    </svg>
  );
}
