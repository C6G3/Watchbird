import "server-only";
import type { Insight, ScanSubject } from "./types";

// Photo → insight, in two passes:
//   1. (crops only, optional) a small PlantVillage classifier gives top labels.
//      Fast and specific, but only knows 38 leaf classes.
//   2. A vision-language model looks at the photo, the farmer's note and the
//      classifier's guess, and writes the structured insight the UI shows.
// Both run on Hugging Face Inference Providers with one HF_TOKEN.

const ROUTER = "https://router.huggingface.co";

const chatEndpoint = () => {
  const base = process.env.HF_BASE_URL?.replace(/\/+$/, "");
  if (!base) return `${ROUTER}/v1/chat/completions`;
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
};

export const visionModel = () => process.env.HF_VISION_MODEL || "Qwen/Qwen2.5-VL-7B-Instruct";
const maxTokens = () => Math.max(700, Number(process.env.HF_MAX_TOKENS) || 2500);

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

function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = match ? match[1].trim() : text.trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }
  const rawFirst = text.indexOf("{");
  const rawLast = text.lastIndexOf("}");
  if (rawFirst !== -1 && rawLast > rawFirst) {
    return text.slice(rawFirst, rawLast + 1);
  }
  return "";
}

function parseInsight(text: string, finishReason?: string): Omit<Insight, "classifier"> {
  if (finishReason === "length") {
    throw new Error("The model response ran out of output tokens before completing. Try a closer photo or higher token limit.");
  }

  const jsonStr = extractJson(text);
  if (!jsonStr) {
    throw new Error("The model could not produce a structured diagnosis. Please take a clearer, closer photo and try again.");
  }

  let raw: Partial<Insight>;
  try {
    const sanitized = jsonStr.replace(/,\s*([}\]])/g, "$1");
    raw = JSON.parse(sanitized) as Partial<Insight>;
  } catch (err) {
    throw new Error(`The model output was not valid JSON (${(err as Error).message}). Please try scanning again.`);
  }

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

  const res = await fetch(chatEndpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: visionModel(),
      max_tokens: maxTokens(),
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

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) {
      throw new Error("Vision AI rate limit or quota exceeded. Please wait a moment or check your API plan limits.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("Vision AI authentication failed. Please verify your HF_TOKEN.");
    }
    throw new Error(`Vision model failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const body = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  const choice = body.choices?.[0];
  if (!choice?.message?.content) {
    if (choice?.finish_reason === "length") {
      throw new Error("The model response ran out of tokens during thinking. Try increasing token limits or using a closer photo.");
    }
    throw new Error("The model returned an empty response. Please try scanning again.");
  }

  return { ...parseInsight(choice.message.content, choice.finish_reason), classifier };
}
