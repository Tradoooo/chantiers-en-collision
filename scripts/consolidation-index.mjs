#!/usr/bin/env node
// consolidation-index.mjs — transforme docs/consolidation/data/all.tsv en un
// index markdown lisible, groupé par famille, découpé en parties (< 500 lignes).
//
// Usage: node scripts/consolidation-index.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DATA = join(ROOT, "docs/consolidation/data");
const OUT_DIR = join(ROOT, "docs/consolidation");
const MAX_LINES = 450;

const FAMILY_LABEL = {
  "core-domain": "Domaine & services (src/core, src/services)",
  "storage-dual": "Stockage dual (src/storage/memory vs src/storage/forge)",
  "glue-mcp": "Glue Forge & outils MCP (src/glue, manifest.yml)",
  "site-demo": "Site public & démo (site/, src/simulation)",
  observation: "Chemins d'observation (hook, watcher, pont MCP, CI)",
  "docs-sprawl": "Documentation & récit (docs/, README)",
  "proofs-ops": "Preuves, CI & déploiement (scripts/, .github)",
  "data-tests": "Données, apprentissage & tests",
  "story-ecosystem": "Pitch, parcours juges & écosystème",
  "cross-cutting": "Traversant (nommage, config, erreurs, sécurité)",
};

function readRows() {
  const lines = readFileSync(join(DATA, "all.tsv"), "utf8").split("\n").filter(Boolean);
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => Object.fromEntries(header.map((h, i) => [h, line.split("\t")[i]])));
}

function groupByFamily(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.famille)) map.set(row.famille, []);
    map.get(row.famille).push(row);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderPart(rows, partIndex, total) {
  const out = [`# 1000 idées de consolidation — partie ${partIndex}/${total}`, ""];
  out.push(`> Généré le ${new Date().toISOString().slice(0, 10)} · source : \`docs/consolidation/data/all.tsv\``);
  out.push("> Chaque ligne : `id · type · impact · effort(j) · risque · idée` — le détail est dans la description du fichier TSV.");
  out.push("");
  for (const [famille, list] of groupByFamily(rows)) {
    out.push(`## ${FAMILY_LABEL[famille] ?? famille} — \`${famille}\` (${list.length})`);
    out.push("");
    for (const r of list) {
      out.push(`- **${r.id}** · \`${r.type}\` · impact ${r.impact} · ${r.effort_jours} j · ${r.risque} — ${r.titre}`);
    }
    out.push("");
  }
  return out.join("\n");
}

function main() {
  const rows = readRows();
  const linesPerPart = Math.ceil(rows.length / Math.ceil((rows.length * 1.35) / MAX_LINES));
  const chunks = [];
  for (let i = 0; i < rows.length; i += linesPerPart) chunks.push(rows.slice(i, i + linesPerPart));
  const total = chunks.length;
  chunks.forEach((chunk, idx) => {
    const path = join(OUT_DIR, `IDEES-1000-${idx + 1}.md`);
    writeFileSync(path, renderPart(chunk, idx + 1, total));
    console.log(`[écrit] ${path} (${chunk.length} idées)`);
  });
  console.log(`[total] ${rows.length} idées · ${total} parties`);
}

main();
