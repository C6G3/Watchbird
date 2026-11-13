"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import InsightView from "./InsightView";
import type { Farm, Insight, ScanSubject } from "@/lib/types";

const SUBJECTS: { value: ScanSubject; label: string }[] = [
  { value: "crop", label: "Crop" },
  { value: "livestock", label: "Livestock" },
  { value: "soil", label: "Soil" },
  { value: "other", label: "Other" },
];

// Phones send 12 MP photos; the models only need ~1 MP. Downscale before upload.
async function shrink(file: File, maxSide = 1280): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.86));
}

export default function ScanUploader({ farms }: { farms: Farm[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [subject, setSubject] = useState<ScanSubject>("crop");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoResult, setDemoResult] = useState<Insight | null>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Paste a screenshot straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (item) setFile(item);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return setError("Add a photo first.");
    setBusy(true);
    setError(null);
    setDemoResult(null);
    const body = new FormData(e.currentTarget);
    body.set("image", await shrink(file), "scan.jpg");
    body.set("subject", subject);
    try {
      const res = await fetch("/api/scans", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed.");
      if (json.demo) setDemoResult(json.result);
      else router.push(`/scans/${json.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="scan-form" onSubmit={submit}>
      <div
        className="drop"
        data-over={over}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f?.type.startsWith("image/")) setFile(f);
        }}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Photo to scan" />
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="M4 7h3l1.5-2h7L17 7h3v12H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            <span>
              <strong>Take or drop a photo</strong>
              <br />
              <span className="muted">or paste a screenshot · JPG, PNG, WebP</span>
            </span>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="field">
        <span className="label">What is in the photo</span>
        <div className="seg seg--full" role="group" aria-label="Subject">
          {SUBJECTS.map((s) => (
            <button key={s.value} type="button" aria-pressed={subject === s.value} onClick={() => setSubject(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {farms.length > 1 ? (
        <label className="field">
          <span className="label">Farm</span>
          <select className="select" name="farm_id" defaultValue={farms[0].id}>
            {farms.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
      ) : farms[0] ? (
        <input type="hidden" name="farm_id" value={farms[0].id} />
      ) : null}

      <label className="field">
        <span className="label">Anything we should know (optional)</span>
        <textarea className="textarea" name="note" maxLength={500} placeholder="e.g. Beans, spots appeared after the rain last week" />
      </label>

      {error ? <p className="notice notice--error" role="alert">{error}</p> : null}

      <button className="btn btn--solid btn--block" disabled={busy || !file}>
        {busy ? "Reading the photo…" : "Get insight"}
      </button>

      {demoResult ? (
        <div className="panel">
          <div className="panel__head">
            <h2>Result</h2>
            <span className="label">Demo · not saved</span>
          </div>
          <div className="panel__body">
            <InsightView insight={demoResult} />
          </div>
        </div>
      ) : null}
    </form>
  );
}
