import { describe, expect, it } from "vitest";
import { DEFAULT_ZONE_CATALOG, isFrozen, zoneForPath } from "../../src/core/zones";
import type { Zone } from "../../src/core/types";

let idSeq = 0;
function zone(name: string, patterns: string[], nature: Zone["nature"], extra?: Partial<Zone>): Zone {
  idSeq += 1;
  return { id: `z-${idSeq}`, repoId: "r1", name, patterns, nature, ...extra };
}

function catalogZones(): Zone[] {
  return DEFAULT_ZONE_CATALOG.map((e) => zone(e.name, e.patterns, e.nature));
}

describe("DEFAULT_ZONE_CATALOG", () => {
  const zones = catalogZones();

  it("recognizes migrations as exclusive", () => {
    expect(zoneForPath(zones, "db/migrations/0042_add_total.sql")?.nature).toBe("exclusive");
    expect(zoneForPath(zones, "db/migrations/0042_add_total.sql")?.name).toBe("migrations");
  });

  it("recognizes lockfiles at any depth", () => {
    for (const p of ["package-lock.json", "app/pnpm-lock.yaml", "yarn.lock", "svc/Cargo.lock", "go.sum"]) {
      expect(zoneForPath(zones, p)?.nature, p).toBe("exclusive");
    }
  });

  it("recognizes schema.prisma and openapi contracts", () => {
    expect(zoneForPath(zones, "prisma/schema.prisma")?.nature).toBe("exclusive");
    expect(zoneForPath(zones, "api/openapi-v1.yaml")?.nature).toBe("exclusive");
    expect(zoneForPath(zones, "openapi.yml")?.nature).toBe("exclusive");
  });

  it("recognizes hotspots", () => {
    expect(zoneForPath(zones, "src/routes.ts")?.nature).toBe("hotspot");
    expect(zoneForPath(zones, "src/locales/fr.json")?.nature).toBe("hotspot");
    expect(zoneForPath(zones, "web/i18n/en.ts")?.nature).toBe("hotspot");
  });

  it("ignores out-of-scope paths", () => {
    expect(zoneForPath(zones, "dist/bundle.js")).toBeUndefined();
    expect(zoneForPath(zones, "src/__snapshots__/a.snap")).toBeUndefined();
    expect(zoneForPath(zones, "src/api.generated.ts")).toBeUndefined();
  });

  it("returns undefined for ordinary paths", () => {
    expect(zoneForPath(zones, "src/billing/invoice.ts")).toBeUndefined();
  });
});

describe("zoneForPath specificity", () => {
  it("team zone more specific than the catalog wins", () => {
    const zones = [
      ...catalogZones(),
      zone("billing-hot", ["src/billing/**"], "hotspot"),
    ];
    expect(zoneForPath(zones, "src/billing/invoice.ts")?.name).toBe("billing-hot");
  });

  it("longest literal prefix wins over ** patterns", () => {
    const zones = [
      zone("all-migrations", ["**/migrations/**"], "exclusive"),
      zone("db-only", ["db/migrations/**"], "hotspot"),
    ];
    expect(zoneForPath(zones, "db/migrations/0042.sql")?.name).toBe("db-only");
    expect(zoneForPath(zones, "svc/migrations/0001.sql")?.name).toBe("all-migrations");
  });

  it("a dir path matches its zone", () => {
    const zones = catalogZones();
    expect(zoneForPath(zones, "db/migrations")?.name).toBe("migrations");
  });
});

describe("isFrozen", () => {
  const frozen = zone("billing-refonte", ["src/billing/**"], "frozen", {
    frozenFrom: "2026-11-24T00:00:00.000Z",
    frozenTo: "2026-11-26T23:59:59.000Z",
  });

  it("is true inside the window, bounds included", () => {
    expect(isFrozen(frozen, "2026-11-24T00:00:00.000Z")).toBe(true);
    expect(isFrozen(frozen, "2026-11-25T12:00:00.000Z")).toBe(true);
    expect(isFrozen(frozen, "2026-11-26T23:59:59.000Z")).toBe(true);
  });

  it("is false outside the window", () => {
    expect(isFrozen(frozen, "2026-11-23T23:59:59.000Z")).toBe(false);
    expect(isFrozen(frozen, "2026-11-27T00:00:00.000Z")).toBe(false);
  });

  it("is false for non-frozen zones", () => {
    expect(isFrozen(zone("x", ["a/**"], "exclusive"), "2026-11-25T12:00:00.000Z")).toBe(false);
  });
});
