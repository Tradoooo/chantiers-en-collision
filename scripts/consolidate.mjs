#!/usr/bin/env node
// consolidate.mjs — agrège les 10 lots TSV d'idées de consolidation,
// valide, déduplique, score et sort une shortlist.
//
// Usage: node scripts/consolidate.mjs [--top 60]
// Sortie:
//   docs/consolidation/data/all.tsv       (1000+ idées dédupliquées)
//   docs/consolidation/data/shortlist.tsv  (top N, trié par score)
//   docs/consolidation/data/stats.md       (répartition familles / types)

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const HEADER = ["id", "famille", "type", "titre", "surface", "impact", "effort_jours", "risque", "description"];

const TYPE_WEIGHT = {
  merge: 2.0, unify: 1.8, delete: 1.6, simplify: 1.4, unwedge: 1.2,
  document: 0.6, pivot: 0.8, refactor: 0.4, guard: 0.2,
};
const RISK_PENALTY = { low: 0, med: 0.8, high: 1.6 };
const STOP_WORDS = new Set(["de", "des", "du", "la", "le", "les", "un", "une", "et", "en", "pour", "par", "dans", "sur", "vers", "au", "aux", "avec", "sans", "que", "qui", "se", "ce", "sa", "son", "les", "au"]);

const topN = (() => {
  const i = process.argv.indexOf("--top");
  return i > 0 ? Number(process.argv[i + 1]) : 60;
})();

// The wave-2 ideas live in their own folder: --dir <dir> --out <dir>.
const dirArg = (() => {
  const i = process.argv.indexOf("--dir");
  return i > 0 ? process.argv[i + 1] : "docs/consolidation/data";
})();
const outArg = (() => {
  const i = process.argv.indexOf("--out");
  return i > 0 ? process.argv[i + 1] : dirArg;
})();

function parseTsv(text, file) {
  const lines = text.split("\n").filter((l) => l.length > 0);
  const rows = [];
  lines.forEach((line, idx) => {
    if (idx === 0) return;
    const cols = line.split("\t");
    if (cols.length !== HEADER.length) {
      console.warn(`[skip] ${file} ligne ${idx + 1}: ${cols.length} colonnes`);
      return;
    }
    rows.push(Object.fromEntries(HEADER.map((h, i) => [h, cols[i].trim()])));
  });
  return rows;
}

function loadAll(dataDir) {
  if (!existsSync(dataDir)) throw new Error(`dossier absent: ${dataDir}`);
  const files = readdirSync(dataDir).filter((f) => /^partie-\d+\.tsv$|^part-.*\.tsv$/.test(f)).sort();
  const rows = [];
  for (const f of files) {
    const part = parseTsv(readFileSync(join(dataDir, f), "utf8"), f);
    console.log(`[lu] ${f}: ${part.length} idées`);
    rows.push(...part);
  }
  return rows;
}

function normalize(title) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .sort()
    .join(" ");
}

function tokens(title) {
  return new Set(normalize(title).split(" ").filter(Boolean));
}

function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function score(idea) {
  const impact = Number(idea.impact) || 0;
  const effort = Math.min(Number(idea.effort_jours) || 0, 15);
  const base = impact * 3 - effort * 0.8 + (TYPE_WEIGHT[idea.type] ?? 0) - (RISK_PENALTY[idea.risque] ?? 0);
  return Math.round(base * 100) / 100;
}

function dedupe(rows) {
  const kept = [];
  const byNorm = new Map();
  for (const idea of rows) {
    const norm = normalize(idea.titre);
    if (byNorm.has(norm)) continue;
    const tk = tokens(idea.titre);
    const dup = kept.find((k) => jaccard(tokens(k.titre), tk) >= 0.82);
    if (dup) continue;
    byNorm.set(norm, idea);
    kept.push(idea);
  }
  return kept;
}

function tsv(rows) {
  return [HEADER.join("\t"), ...rows.map((r) => HEADER.map((h) => r[h]).join("\t"))].join("\n") + "\n";
}

function stats(rows) {
  const byFamille = new Map();
  const byType = new Map();
  const bySurface = new Map();
  for (const r of rows) {
    byFamille.set(r.famille, (byFamille.get(r.famille) ?? 0) + 1);
    byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    bySurface.set(r.surface, (bySurface.get(r.surface) ?? 0) + 1);
  }
  const table = (label, map) =>
    [`| ${label} | n |`, "|---|---|", ...[...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
  return `# Stats — idées de consolidation\n\n${table("famille", byFamille)}\n\n${table("type", byType)}\n\n${table("surface", bySurface)}\n`;
}

function main() {
  const dataDir = join(ROOT, dirArg);
  const outDir = join(ROOT, outArg);
  const raw = loadAll(dataDir);
  const unique = dedupe(raw);
  for (const idea of unique) idea.score = score(idea);
  unique.sort((a, b) => b.score - a.score);
  writeFileSync(join(outDir, "all.tsv"), tsv(unique));
  writeFileSync(join(outDir, "shortlist.tsv"), tsv(unique.slice(0, topN)));
  writeFileSync(join(outDir, "stats.md"), stats(unique));
  console.log(`\n[total] ${raw.length} brutes → ${unique.length} uniques (${raw.length - unique.length} doublons)`);
  console.log(`[shortlist] ${Math.min(topN, unique.length)} idées écrite dans shortlist.tsv`);
}

main();
