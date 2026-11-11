import { describe, expect, it } from "vitest";
import { createMemoryStores } from "../../src/storage/memory";
import { makeClock } from "../../src/testing/clock";
import type { Ctx } from "../../src/services/ctx";
import type { Identity, Worksite } from "../../src/core/types";
import { learningReport } from "../../src/services/learning";
import { declareFootprint } from "../../src/services/declare";
import { reportConflict } from "../../src/services/ingest";

const REPO = "acme/billing";
const T0 = "2026-11-11T09:00:00.000Z";

function makeCtx() {
  const stores = createMemoryStores();
  const clock = makeClock(T0);
  const identity: Identity = { accountId: "lea@example.com", kind: "human", client: "mcp" };
  return { stores, clock, ctx: { stores, now: () => clock.now(), identity, projectId: "PROJ" } as Ctx };
}

async function mergedWorksite(
  base: ReturnType<typeof makeCtx>,
  issueKey: string,
  opts: { predicted?: string[]; attested?: string[]; components?: string[] },
): Promise<Worksite> {
  const repo = await base.stores.repos.ensure("PROJ", REPO);
  await base.stores.zones.seedDefaults(repo.id);
  const w = await base.stores.worksites.create({
    issueKey,
    repoId: repo.id,
    accountId: "dev@example.com",
    kind: "human",
    state: "closed",
    outcome: "merged",
    openedAt: T0,
    lastActivityAt: T0,
    closedAt: T0,
    ticket: { issueKey, components: opts.components ?? [] },
  });
  if (opts.predicted) {
    await base.stores.predictions.save({
      issueKey,
      repoId: repo.id,
      entries: opts.predicted.map((path) => ({
        path,
        kind: path.split("/").pop()!.includes(".") ? ("file" as const) : ("dir" as const),
        confidence: 0.8,
      })),
      confidence: 0.8,
      basis: { componentMatch: true, referenceTickets: [] },
      computedAt: T0,
    });
  }
  if (opts.attested) {
    await base.stores.footprints.add(
      opts.attested.map((path) => ({
        worksiteId: w.id,
        path,
        kind: "file" as const,
        source: "attested" as const,
        mode: "edit" as const,
        at: T0,
      })),
    );
  }
  return w;
}

describe("learningReport — prediction accuracy (§13, CC-25)", () => {
  it("compares predicted vs attested footprints of merged worksites", async () => {
    const base = makeCtx();
    await mergedWorksite(base, "PROJ-1", {
      predicted: ["src/billing"],
      attested: ["src/billing/invoice.ts", "src/billing/tax.ts", "src/other/x.ts"],
      components: ["billing"],
    });
    const report = await learningReport(base.ctx, { repoSlug: REPO });
    // 2 of 3 attested paths were covered by the "src/billing" prediction
    expect(report.accuracy.overall).toBe(0.67);
    expect(report.accuracy.byComponent[0]).toMatchObject({
      component: "billing",
      accuracy: 0.67,
      samples: 3,
    });
  });

  it("falls back to (none) when the ticket has no component", async () => {
    const base = makeCtx();
    await mergedWorksite(base, "PROJ-2", {
      predicted: ["src/a.ts"],
      attested: ["src/a.ts"],
    });
    const report = await learningReport(base.ctx, { repoSlug: REPO });
    expect(report.accuracy.byComponent.map((c) => c.component)).toEqual(["(none)"]);
    expect(report.accuracy.overall).toBe(1);
  });

  it("no merged worksite → no accuracy, empty report shape", async () => {
    const base = makeCtx();
    await base.stores.repos.ensure("PROJ", REPO);
    const report = await learningReport(base.ctx, { repoSlug: REPO });
    expect(report.accuracy.overall).toBeUndefined();
    expect(report.accuracy.samples).toBe(0);
    expect(report.fourNumbers).toBeDefined();
  });
});

describe("learningReport — zone reclassification proposals (§13)", () => {
  it("a directory that always conflicts is proposed as exclusive", async () => {
    const base = makeCtx();
    await mergedWorksite(base, "PROJ-3", { attested: ["src/dbconf/a.sql"] });
    await reportConflict(base.ctx, { issueKey: "PROJ-3", repoSlug: REPO, paths: "src/dbconf/a.sql" });
    await reportConflict(base.ctx, { issueKey: "PROJ-3", repoSlug: REPO, paths: "src/dbconf/b.sql" });
    const report = await learningReport(base.ctx, { repoSlug: REPO });
    const proposal = report.proposals.find((p) => p.pattern === "src/dbconf/**");
    expect(proposal?.suggestedNature).toBe("exclusive");
    expect(proposal?.hits).toBe(2);
  });

  it("a directory overlapped but never conflicting is proposed as hotspot", async () => {
    const base = makeCtx();
    // three collisions on src/routes/table.ts, zero real conflicts
    await declareFootprint(base.ctx, {
      issueKey: "PROJ-4", repoSlug: REPO, paths: "src/routes/table.ts", session: "s1",
    });
    for (const [i, session] of [["PROJ-5", "s2"], ["PROJ-6", "s3"], ["PROJ-7", "s4"]] as const) {
      const ctx = {
        ...base.ctx,
        identity: { accountId: `dev${i}@example.com`, kind: "agent", client: "mcp", sessionRef: session } as Identity,
      } as Ctx;
      await declareFootprint(ctx, { issueKey: i, repoSlug: REPO, paths: "src/routes/table.ts", session });
    }
    const report = await learningReport(base.ctx, { repoSlug: REPO });
    const proposal = report.proposals.find((p) => p.pattern === "src/routes/**");
    expect(proposal?.suggestedNature).toBe("hotspot");
    expect(proposal?.evidence).toContain("never a real conflict");
  });

  it("never proposes against the default catalog zones", async () => {
    const base = makeCtx();
    // migrations is already exclusive by default: conflicts there change nothing
    await mergedWorksite(base, "PROJ-8", { attested: ["db/migrations/0001.sql"] });
    await reportConflict(base.ctx, { issueKey: "PROJ-8", repoSlug: REPO, paths: "db/migrations/0001.sql" });
    await reportConflict(base.ctx, { issueKey: "PROJ-8", repoSlug: REPO, paths: "db/migrations/0002.sql" });
    const report = await learningReport(base.ctx, { repoSlug: REPO });
    expect(report.proposals.find((p) => p.pattern.startsWith("db/migrations"))).toBeUndefined();
  });
});
