/* --- PART 1 --- */
import { describe, expect, it } from "vitest";
import { predictFootprintWithLlm } from "../../src/services/predict-llm";
import type { LlmPrediction, LlmPredictorConfig } from "../../src/services/predict-llm";
import { mergeLlmPrediction } from "../../src/glue/prediction";
import type { PredictionResult } from "../../src/core/predict";
import type { MergedTicketHistory, TicketMeta } from "../../src/core/types";

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
  init: RequestInit | undefined;
}

/** Pure recording fetch — no network, no mocks of the module under test. */
function mockFetch(responder: (call: CapturedCall) => Promise<Response>) {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const call: CapturedCall = {
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      init,
    };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function jsonResponse(content: string, status = 200): Promise<Response> {
  const payload = { choices: [{ message: { role: "assistant", content } }] };
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const TICKET: TicketMeta = {
  issueKey: "PROJ-42",
  summary: "Fix invoice retry loop",
  components: ["billing"],
};

const HISTORY = [
  {
    issueKey: "PROJ-7",
    components: ["billing"],
    summary: "Invoice retries",
    paths: ["src/billing/invoice.ts", "src/billing"],
  },
  { issueKey: "PROJ-9", components: ["core"], paths: ["src/core/paths.ts"] },
] satisfies MergedTicketHistory[];

function baseConfig(fetchImpl: typeof fetch, extra?: Partial<LlmPredictorConfig>): LlmPredictorConfig {
  return {
    baseUrl: "https://api.inferhub.dev/v1",
    apiKey: "test-key-not-a-secret",
    fetchImpl,
    ...extra,
  };
}

describe("predictFootprintWithLlm", () => {
  it("maps an ideal JSON reply: kind via classifyPath, confidence clamped", async () => {
    const ideal = JSON.stringify({
      paths: [
        { path: "src/billing/invoice.ts", confidence: 0.9 },
        { path: "src/billing", confidence: 1.7 }, // clamped to 1
        { path: "src/billing/*.gen.ts", confidence: -0.5 }, // clamped to 0
        { path: 42, confidence: 0.5 }, // junk entry dropped
      ],
      references: ["PROJ-7", "PROJ-9", 123],
    });
    const { fetchImpl, calls } = mockFetch(() => jsonResponse(ideal));
    const out = await predictFootprintWithLlm(TICKET, HISTORY, baseConfig(fetchImpl));
    expect(out).toBeDefined();
    expect(out?.entries).toHaveLength(3);
    expect(out?.entries[0]).toEqual({
      path: "src/billing/invoice.ts",
      kind: "file",
      confidence: 0.9,
    });
    expect(out?.entries[1]).toEqual({ path: "src/billing", kind: "dir", confidence: 1 });
    expect(out?.entries[2]).toEqual({
      path: "src/billing/*.gen.ts",
      kind: "pattern",
      confidence: 0,
    });
    expect(out?.referenceTickets).toEqual(["PROJ-7", "PROJ-9"]);
    expect(out?.model).toBe("combo/cheap");
    expect(calls[0]?.url).toBe("https://api.inferhub.dev/v1/chat/completions");
    expect(calls[0]?.body.temperature).toBe(0);
    expect(calls[0]?.body.response_format).toEqual({ type: "json_object" });
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: "Bearer test-key-not-a-secret" });
  });

  it("parses a reply wrapped in ```json fences with trailing prose", async () => {
    const fenced = '```json\n{"paths":[{"path":"src/billing","confidence":0.6}],"references":["PROJ-7"]}\n```\nHere you go!';
    const { fetchImpl } = mockFetch(() => jsonResponse(fenced));
    const out = await predictFootprintWithLlm(TICKET, HISTORY, baseConfig(fetchImpl));
    expect(out?.entries).toEqual([{ path: "src/billing", kind: "dir", confidence: 0.6 }]);
    expect(out?.referenceTickets).toEqual(["PROJ-7"]);
  });

/* --- PART 2 --- */
  it("returns undefined on HTTP 500 — no throw", async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse("{}", 500));
    await expect(
      predictFootprintWithLlm(TICKET, HISTORY, baseConfig(fetchImpl)),
    ).resolves.toBeUndefined();
  });

  it("returns undefined on invalid JSON content", async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse("sorry, I cannot answer with JSON"));
    const out = await predictFootprintWithLlm(TICKET, HISTORY, baseConfig(fetchImpl));
    expect(out).toBeUndefined();
  });

  it("returns undefined on valid JSON without a paths array", async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse('{"nope":true}'));
    const out = await predictFootprintWithLlm(TICKET, HISTORY, baseConfig(fetchImpl));
    expect(out).toBeUndefined();
  });

  it("times out via AbortController when the fetch never resolves", async () => {
    let seenSignal: AbortSignal | undefined;
    const fetchImpl = ((_input: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined); // never settles
    }) as typeof fetch;
    const started = Date.now();
    const out = await predictFootprintWithLlm(
      TICKET,
      HISTORY,
      baseConfig(fetchImpl, { timeoutMs: 50 }),
    );
    expect(out).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5000);
    expect(seenSignal?.aborted).toBe(true);
  });

  it("sends summary and history paths but NEVER file contents (whitelisted fields)", async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse('{"paths":[],"references":[]}'));
    // Runtime objects can carry more than the contract: the prompt builder
    // must whitelist issueKey/components/summary/paths — no content leaks.
    const leaky = [
      { ...HISTORY[0], content: "TOP-SECRET-FILE-CONTENT" },
    ] as unknown as MergedTicketHistory[];
    const leakyTicket = {
      ...TICKET,
      description: "TOP-SECRET-DESCRIPTION",
    } as unknown as TicketMeta; // runtime objects can carry extra fields
    await predictFootprintWithLlm(leakyTicket, leaky, baseConfig(fetchImpl));
    const body = JSON.stringify(calls[0]?.body);
    expect(body).toContain("Fix invoice retry loop"); // summary IS sent
    expect(body).toContain("PROJ-7"); // history issueKey IS sent
    expect(body).toContain("src/billing/invoice.ts"); // history paths ARE sent
    expect(body).toContain("billing"); // components ARE sent
    expect(body).not.toContain("TOP-SECRET-FILE-CONTENT"); // contents NEVER
    expect(body).not.toContain("TOP-SECRET-DESCRIPTION"); // extra fields NEVER
  });

  it("caps the history at 12 tickets in the prompt", async () => {
    const many: MergedTicketHistory[] = Array.from({ length: 20 }, (_, i) => ({
      issueKey: `PROJ-${100 + i}`,
      components: ["billing"],
      paths: [`src/f${i}.ts`],
    }));
    const { fetchImpl, calls } = mockFetch(() => jsonResponse('{"paths":[],"references":[]}'));
    await predictFootprintWithLlm(TICKET, many, baseConfig(fetchImpl));
    const body = JSON.stringify(calls[0]?.body);
    expect(body).toContain("PROJ-111"); // 12th ticket present
    expect(body).not.toContain("PROJ-112"); // 13th ticket excluded
  });

  it("defaults the model to combo/cheap and honours an override", async () => {
    const { fetchImpl, calls } = mockFetch(() => jsonResponse('{"paths":[],"references":[]}'));
    await predictFootprintWithLlm(TICKET, HISTORY, baseConfig(fetchImpl));
    expect(calls[0]?.body.model).toBe("combo/cheap");
    await predictFootprintWithLlm(TICKET, HISTORY, baseConfig(fetchImpl, { model: "mixtral-large" }));
    expect(calls[1]?.body.model).toBe("mixtral-large");
  });
});

/* --- PART 3 --- */
describe("mergeLlmPrediction (glue/prediction — LLM as appoint)", () => {
  it("confidence = max(heuristic, llm × 0.9), llm entries appended, refs tagged llm:", () => {
    const heuristic: PredictionResult = {
      entries: [{ path: "src/billing/invoice.ts", kind: "file", confidence: 0.3 }],
      confidence: 0.2,
      referenceTickets: ["PROJ-7"],
      componentMatch: true,
    };
    const llm: LlmPrediction = {
      entries: [
        { path: "src/billing/invoice.ts", kind: "file", confidence: 0.95 }, // duplicate
        { path: "src/billing/retry.ts", kind: "file", confidence: 0.8 }, // new
      ],
      referenceTickets: ["PROJ-9"],
      model: "combo/cheap",
    };
    const merged = mergeLlmPrediction(heuristic, llm);
    expect(merged.entries).toHaveLength(2);
    expect(merged.entries.map((entry) => entry.path)).toEqual([
      "src/billing/retry.ts", // 0.8 — re-sorted by confidence, llm entry first
      "src/billing/invoice.ts", // 0.3 — heuristic entry kept, not duplicated
    ]);
    expect(merged.confidence).toBe(0.86); // max(0.2, 0.95 × 0.9 = 0.855 → 0.86)
    expect(merged.referenceTickets).toEqual(["PROJ-7", "llm:PROJ-9"]);
    expect(merged.componentMatch).toBe(true);
  });

  it("never lets the discounted LLM exceed 1 and keeps the heuristic when stronger", () => {
    const heuristic: PredictionResult = {
      entries: [{ path: "src/a.ts", kind: "file", confidence: 0.9 }],
      confidence: 0.9,
      referenceTickets: [],
      componentMatch: true,
    };
    const llm: LlmPrediction = {
      entries: [{ path: "src/b.ts", kind: "file", confidence: 1 }],
      referenceTickets: [],
      model: "combo/cheap",
    };
    const merged = mergeLlmPrediction(heuristic, llm);
    expect(merged.confidence).toBe(0.9); // max(0.9, 0.9) — heuristic wins
    expect(merged.entries).toHaveLength(2);
  });
});
