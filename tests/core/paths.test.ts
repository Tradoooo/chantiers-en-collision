import { describe, expect, it } from "vitest";
import {
  classifyPath,
  entriesOverlap,
  literalPrefix,
  matchesGlob,
  normalizePath,
  parentDirs,
  pathContains,
} from "../../src/core/paths";

describe("normalizePath", () => {
  it("strips ./, leading/trailing slashes and doubles", () => {
    expect(normalizePath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizePath("/src/a.ts")).toBe("src/a.ts");
    expect(normalizePath("src//a.ts")).toBe("src/a.ts");
    expect(normalizePath("src/billing/")).toBe("src/billing");
    expect(normalizePath("  src/a.ts  ")).toBe("src/a.ts");
    expect(normalizePath("")).toBe("");
    expect(normalizePath("./")).toBe("");
  });
});

describe("classifyPath", () => {
  it("detects files, dirs and patterns", () => {
    expect(classifyPath("src/a.ts")).toBe("file");
    expect(classifyPath("package-lock.json")).toBe("file");
    expect(classifyPath("src/billing/")).toBe("dir");
    expect(classifyPath("src/billing")).toBe("dir");
    expect(classifyPath("db/migrations")).toBe("dir");
    expect(classifyPath("**/migrations/**")).toBe("pattern");
    expect(classifyPath("openapi*.y*ml")).toBe("pattern");
    expect(classifyPath("src/?.ts")).toBe("pattern");
  });
});

describe("parentDirs", () => {
  it("lists dirs shallowest first", () => {
    expect(parentDirs("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(parentDirs("a")).toEqual([]);
    expect(parentDirs("a/b")).toEqual(["a"]);
  });
});

describe("pathContains", () => {
  it("dir covers equality and descendants", () => {
    expect(pathContains("src/billing", "src/billing/invoice.ts")).toBe(true);
    expect(pathContains("src/billing", "src/billing")).toBe(true);
    expect(pathContains("src", "src/billing/deep/x.ts")).toBe(true);
  });
  it("does not over-match prefixes", () => {
    expect(pathContains("src/a", "src/ab")).toBe(false);
    expect(pathContains("src/billing/invoice.ts", "src/billing")).toBe(false);
  });
});

describe("matchesGlob", () => {
  it("handles ** across segments", () => {
    expect(matchesGlob("db/migrations/**", "db/migrations/0042.sql")).toBe(true);
    expect(matchesGlob("**/migrations/**", "db/migrations/0042.sql")).toBe(true);
    expect(matchesGlob("**/migrations/**", "migrations/0042.sql")).toBe(true);
    expect(matchesGlob("**/migrations/**", "src/migrations")).toBe(true);
    expect(matchesGlob("**/migrations/**", "src/other/x.sql")).toBe(false);
    expect(matchesGlob("dist/**", "dist/x.js")).toBe(true);
    expect(matchesGlob("dist/**", "dist/a/b/c.js")).toBe(true);
    expect(matchesGlob("dist/**", "src/dist/x.js")).toBe(false);
  });
  it("handles * within one segment and ?", () => {
    expect(matchesGlob("**/routes.*", "src/routes.ts")).toBe(true);
    expect(matchesGlob("**/routes.*", "src/api/routes.js")).toBe(true);
    expect(matchesGlob("**/routes.*", "src/routes/x.ts")).toBe(false);
    expect(matchesGlob("src/*/x.ts", "src/a/x.ts")).toBe(true);
    expect(matchesGlob("src/*/x.ts", "src/a/b/x.ts")).toBe(false);
    expect(matchesGlob("src/?.ts", "src/a.ts")).toBe(true);
    expect(matchesGlob("src/?.ts", "src/ab.ts")).toBe(false);
  });
  it("handles complex filename patterns", () => {
    expect(matchesGlob("openapi*.y*ml", "openapi-v1.yaml")).toBe(true);
    // slash-free pattern → basename at any depth (gitignore semantics)
    expect(matchesGlob("openapi*.y*ml", "api/openapi.yml")).toBe(true);
    expect(matchesGlob("**/openapi*.y*ml", "api/openapi-v2.yaml")).toBe(true);
    expect(matchesGlob("*.generated.*", "src/api.generated.ts")).toBe(true);
    expect(matchesGlob("*.generated.*", "api.generated.ts")).toBe(true);
  });
  it("matches slash-free patterns on the basename at any depth", () => {
    expect(matchesGlob("package-lock.json", "app/package-lock.json")).toBe(true);
    expect(matchesGlob("package-lock.json", "package-lock.json")).toBe(true);
    expect(matchesGlob("package-lock.json", "app/package-lock.json.bak")).toBe(false);
    expect(matchesGlob("Cargo.lock", "svc/Cargo.lock")).toBe(true);
  });
  it("matches **/__snapshots__/**", () => {
    expect(matchesGlob("**/__snapshots__/**", "src/__snapshots__/a.snap")).toBe(true);
    expect(matchesGlob("**/locales/**", "src/locales/fr.json")).toBe(true);
    expect(matchesGlob("**/i18n/**", "packages/web/i18n/en.ts")).toBe(true);
  });
});

describe("literalPrefix", () => {
  it("stops at the first glob segment", () => {
    expect(literalPrefix("src/**/*.ts")).toBe("src");
    expect(literalPrefix("**/migrations/**")).toBe("");
    expect(literalPrefix("src/a/x.ts")).toBe("src/a/x.ts");
  });
});

describe("entriesOverlap", () => {
  it("file vs file: equality only", () => {
    expect(entriesOverlap("src/a.ts", "file", "src/a.ts", "file")).toBe(true);
    expect(entriesOverlap("src/a.ts", "file", "src/b.ts", "file")).toBe(false);
  });
  it("dir vs file: containment both ways", () => {
    expect(entriesOverlap("src/billing", "dir", "src/billing/invoice.ts", "file")).toBe(true);
    expect(entriesOverlap("src/billing/invoice.ts", "file", "src/billing", "dir")).toBe(true);
    expect(entriesOverlap("src/a", "dir", "src/ab/x.ts", "file")).toBe(false);
    expect(entriesOverlap("src/billing/", "dir", "src/billing/invoice.ts", "file")).toBe(true);
  });
  it("dir vs dir: containment either way", () => {
    expect(entriesOverlap("src", "dir", "src/billing", "dir")).toBe(true);
    expect(entriesOverlap("src/billing", "dir", "src", "dir")).toBe(true);
    expect(entriesOverlap("src/billing", "dir", "src/auth", "dir")).toBe(false);
  });
  it("pattern vs literal", () => {
    expect(entriesOverlap("**/migrations/**", "pattern", "db/migrations/0042.sql", "file")).toBe(true);
    expect(entriesOverlap("db/migrations/0042.sql", "file", "**/migrations/**", "pattern")).toBe(true);
    expect(entriesOverlap("*.generated.*", "pattern", "src/api.generated.ts", "file")).toBe(true);
    expect(entriesOverlap("dist/**", "pattern", "dist", "dir")).toBe(true);
    expect(entriesOverlap("src/billing", "dir", "src/**/*.ts", "pattern")).toBe(true);
    expect(entriesOverlap("src/auth", "dir", "src/billing/**", "pattern")).toBe(false);
  });
  it("pattern vs pattern: compatible literal prefixes", () => {
    expect(entriesOverlap("**/migrations/**", "pattern", "db/migrations/*.sql", "pattern")).toBe(true);
    expect(entriesOverlap("src/a/**", "pattern", "src/a/x/**", "pattern")).toBe(true);
    expect(entriesOverlap("src/a/**", "pattern", "src/b/**", "pattern")).toBe(false);
    expect(entriesOverlap("**/locales/**", "pattern", "*.generated.*", "pattern")).toBe(true);
  });
  it("empty paths never overlap", () => {
    expect(entriesOverlap("", "file", "src/a.ts", "file")).toBe(false);
  });
});
