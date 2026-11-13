import "server-only";
import type { Insight, ScanSubject } from "./types";

// Photo → insight, in two passes:
//   1. (crops only, optional) a small PlantVillage classifier gives top labels.
//      Fast and specific, but only knows 38 leaf classes.
//   2. A vision-language model looks at the photo, the farmer's note and the
//      classifier's guess, and writes the structured insight the UI shows.
// Both run on Hugging Face Inference Providers with one HF_TOKEN.

const ROUTER = "https://router.huggingface.co";

export const visionModel = () => process.env.HF_VISION_MODEL || "Qwen/Qwen2.5-VL-7B-Instruct";

async function classify(image: ArrayBuffer, mime: string, token: string) {
  const model = process.env.HF_PLANT_CLASSIFIER;
  if (!model) return undefined;
  try {
    const res = await fetch(`${ROUTER}/hf-inference/models/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": mime },
      body: image,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return undefined;
    const labels = (await res.json()) as { label: string; score: number }[];
    return labels.slice(0, 3).map((l) => ({ label: l.label.replace(/_+/g, " ").trim(), score: l.score }));
  } catch {
    return undefined;
  }
}

const SUBJECT_HINT: Record<ScanSubject, string> = {
  crop: "a crop, plant or leaf",
  livestock: "a farm animal",
  soil: "soil or a field surface",
  other: "something on a farm",
};

function prompt(subject: ScanSubject, note: string, hint?: { label: string; score: number }[]) {
  return [
    `You are an agronomist and vet helping a small-scale farmer in East Africa. The photo shows ${SUBJECT_HINT[subject]}.`,
    note ? `The farmer says: "${note}".` : "",
    hint?.length
      ? `A leaf-disease classifier guessed: ${hint.map((h) => `${h.label} (${Math.round(h.score * 100)}%)`).join(", ")}. Use it only if the photo agrees.`
      : "",
    "Reply with JSON only, no prose, matching:",
    `{"title": short name of what you see and its problem, "condition": "healthy"|"stressed"|"diseased"|"pest"|"injured"|"unknown",`,
    `"urgency": "low"|"medium"|"high", "confidence": 0..1, "summary": 2-3 plain sentences,`,
    `"findings": [what in the photo supports this], "actions": [concrete next steps the farmer can take today, cheapest first]}`,
    "If the photo is unclear, say so with condition \"unknown\" and ask for a better photo in actions. Never invent product brand names.",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseInsight(text: string): Omit<Insight, "classifier"> {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const raw = JSON.parse(json) as Partial<Insight>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T) =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    title: String(raw.title ?? "Unclear photo"),
    condition: pick(raw.condition, ["healthy", "stressed", "diseased", "pest", "injured", "unknown"] as const, "unknown"),
    urgency: pick(raw.urgency, ["low", "medium", "high"] as const, "low"),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    summary: String(raw.summary ?? ""),
    findings: Array.isArray(raw.findings) ? raw.findings.map(String).slice(0, 6) : [],
    actions: Array.isArray(raw.actions) ? raw.actions.map(String).slice(0, 6) : [],
  };
}

export async function analysePhoto(image: ArrayBuffer, mime: string, subject: ScanSubject, note: string): Promise<Insight> {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("HF_TOKEN is not set, so photos can't be analysed yet.");

  const classifier = subject === "crop" ? await classify(image, mime, token) : undefined;
  const dataUrl = `data:${mime};base64,${Buffer.from(image).toString("base64")}`;

  const res = await fetch(`${ROUTER}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: visionModel(),
      max_tokens: 700,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt(subject, note, classifier) },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Vision model failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return { ...parseInsight(body.choices[0]?.message?.content ?? ""), classifier };
}
