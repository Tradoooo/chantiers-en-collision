/* --- PART 1 --- */
/**
 * services/predict-llm — footprint prediction through an OpenAI-compatible
 * gateway (spec §5 "Prédite", §14 CC-24: prediction from the ticket text, by
 * the model, cached). Pure service: no @forge/* import — the native fetch of
 * the node 22 runtime is enough (egress is allowlisted in manifest.yml under
 * permissions.external.fetch.backend).
 *
 * FAIL-SOFT (spec §26 "Prédiction peu fiable → jamais bloquante"): every
 * error — network, HTTP != 200, malformed JSON, timeout — returns undefined
 * and never throws. The LLM is a supplement to the heuristic of
 * core/predict, wired in glue/prediction.
 *
 * PRIVACY: the prompt carries ONLY the ticket summary, its components, and
 * the issueKey/components/paths of merged tickets — never file contents.
 */

import type { MergedTicketHistory, PredictedPath, TicketMeta } from "../core/types";
import { classifyPath } from "../core/paths";

export interface LlmPredictorConfig {
  /** Gateway root, e.g. https://api.inferhub.dev/v1 */
  baseUrl: string;
  /** Bearer token — read from the environment by the glue, never stored. */
  apiKey: string;
  /** Default "combo/cheap". */
  model?: string;
  /** Default 8000. */
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export interface LlmPrediction {
  entries: PredictedPath[];
  referenceTickets: string[];
  model: string;
}

const DEFAULT_MODEL = "combo/cheap";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_HISTORY_TICKETS = 12;
const MAX_PATHS = 30;
const MAX_REFERENCES = 10;

const SYSTEM_PROMPT =
  "You predict the file footprint of a Jira ticket from its text and from " +
  "similar merged tickets of the same repository. Reply with JSON ONLY, no " +
  'prose, no markdown fences: {"paths":[{"path":"<repo-relative path>",' +
  '"confidence":<number 0..1>}],"references":["<ISSUE-KEY>"]}. "paths" lists ' +
  "the files or directories the ticket will most likely touch (most likely " +
  'first, max 30). "references" lists the issue keys of the merged tickets ' +
  "you relied on. Never invent file contents; only paths.";

/** Clamp to 0..1 and round to two decimals (same convention as core/predict). */
function clampConfidence(value: unknown): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
}

/** One history line: issueKey, components, paths — nothing else. */
function historyLine(t: MergedTicketHistory): string {
  const comps = t.components.length > 0 ? t.components.join(", ") : "-";
  return `- ${t.issueKey} [${comps}] paths: ${t.paths.join(", ")}`;
}

/** User prompt: ticket summary + components, up to 12 history tickets. */
function buildUserPrompt(ticket: TicketMeta, history: MergedTicketHistory[]): string {
  const lines = [
    `Ticket ${ticket.issueKey}`,
    `Summary: ${ticket.summary ?? "(none)"}`,
    `Components: ${ticket.components.length > 0 ? ticket.components.join(", ") : "(none)"}`,
    "",
    `Merged tickets of the same repository (${history.length} total, showing up to ${MAX_HISTORY_TICKETS}):`,
  ];
  for (const t of history.slice(0, MAX_HISTORY_TICKETS)) lines.push(historyLine(t));
  lines.push("", 'Reply with JSON only: {"paths":[...],"references":[...]}');
  return lines.join("\n");
}

/* --- PART 2 --- */
/** First balanced {...} block, markdown fences stripped; undefined if none. */
function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (escaped) {
      escaped = false;
    } else if (c === "\\") {
      escaped = inString;
    } else if (c === '"') {
      inString = !inString;
    } else if (!inString && c === "{") {
      depth += 1;
    } else if (!inString && c === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Tolerant parse of one model entry; undefined when the entry is junk. */
function toPredictedPath(raw: unknown): PredictedPath | undefined {
  if (typeof raw === "string" && raw.trim() !== "") {
    return { path: raw.trim(), kind: classifyPath(raw.trim()), confidence: 0.5 };
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const path = (raw as { path?: unknown }).path;
  if (typeof path !== "string" || path.trim() === "") return undefined;
  return {
    path: path.trim(),
    kind: classifyPath(path.trim()),
    confidence: clampConfidence((raw as { confidence?: unknown }).confidence),
  };
}

/** Validate the decoded payload: typed entries, capped lists. */
function toPrediction(parsed: unknown, model: string): LlmPrediction | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const rawPaths = (parsed as { paths?: unknown }).paths;
  if (!Array.isArray(rawPaths)) return undefined;
  const entries = rawPaths
    .map(toPredictedPath)
    .filter((entry): entry is PredictedPath => entry !== undefined)
    .slice(0, MAX_PATHS);
  const rawRefs = (parsed as { references?: unknown }).references;
  const referenceTickets = (Array.isArray(rawRefs) ? rawRefs : [])
    .filter((ref): ref is string => typeof ref === "string" && ref.trim() !== "")
    .map((ref) => ref.trim())
    .slice(0, MAX_REFERENCES);
  return { entries, referenceTickets, model };
}

/** POST {baseUrl}/chat/completions with an AbortController timeout. */
async function requestCompletion(
  cfg: LlmPredictorConfig,
  model: string,
  messages: { role: string; content: string }[],
): Promise<string | undefined> {
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = cfg.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Race the fetch against the abort so the timeout holds even if a custom
  // fetchImpl ignores the signal (native fetch honours it and rejects early).
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("llm timeout")), {
      once: true,
    });
  });
  try {
    const response = await Promise.race([
      doFetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      }),
      aborted,
    ]);
    if (!response.ok) return undefined;
    const json = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = json?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : undefined;
  } catch {
    return undefined; // network error, timeout (abort), unparsable body
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Predict the footprint of a ticket through the LLM gateway. Any failure —
 * network, HTTP != 200, malformed JSON, timeout, empty result — resolves to
 * undefined; this function NEVER throws and NEVER blocks the caller.
 */
export async function predictFootprintWithLlm(
  ticket: TicketMeta,
  history: MergedTicketHistory[],
  cfg: LlmPredictorConfig,
): Promise<LlmPrediction | undefined> {
  const model = cfg.model ?? DEFAULT_MODEL;
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(ticket, history) },
  ];
  const content = await requestCompletion(cfg, model, messages);
  if (content === undefined) return undefined;
  const block = extractJsonObject(content);
  if (block === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return undefined;
  }
  const prediction = toPrediction(parsed, model);
  if (prediction === undefined || prediction.entries.length === 0) return undefined;
  return prediction;
}
