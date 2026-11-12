# BRIEF — 1000 idées de consolidation (chantiers-en-collision)

## 1. Ce qu'est le projet

App **Forge pour Jira** (`chantiers-en-collision`, licence MIT, catégorie Codegeist 2026
« Apps for Software Teams »). Soumission : **22/12/2026**, gel des fonctionnalités 15/12.

Promesse : *« Jira sait à chaque instant qui travaille sur quelle partie du code, personnes et
agents confondus : chaque travail en cours a une emprise (footprint) sur le dépôt, tout
chevauchement est signalé avant la première ligne écrite, et l'app dit quoi faire — attendre,
se coordonner, découper, ou lancer en parallèle sans risque. »*

Le moteur calcule : 4 sources d'emprise (predicted / declared / observed / attested), un verdict
(`free` / `caution` / `wait` / `stop`), 6 degrés de collision (D0 zone, D1 dossier, D2 fichier,
D3 delete/move/rename, D4 ressource exclusive, D5 contrat cassé), 6 sorties de conflit
(wait, sequence, coordinate, split, merge, override), les vagues de travail parallèle, les
réservations expirables, la vie d'un chantier (prédit → dormant → fermé).

État réel au 12/11/2026 :
- App **déployée** sur un site Forge de dev (`one-atlas-cndz.atlassian.net`), données réelles
  (`PROJ-1…8`, composants, priorités), collisions D2/D4 réelles, une prédiction LLM déclenchée.
- **Site public** `https://baptistefaisy.github.io/chantiers-en-collision/` branché sur les routes
  démo du déploiement (`GET /demo/state`, `POST /demo/verdict`), fallback local assumé.
- 16 outils MCP (`rovo:mcp`), un hook natif, un watcher local universel, un plugin OpenCode,
  un pont MCP stdio, des gabarits CI, un skill, un protocole ouvert dans un repo séparé
  (`open-footprint-protocol`) et un repo d'exemple (`billing-demo`).
- 382+ tests verts, CI verte (lint, typecheck, « manifest gate », tests, bundle du site),
  `docs/PROOFS.md` régénéré par `scripts/prove.py` (reçus horodatés), job planifié toutes les 3 h.

## 2. Arbre (pour ancrer les idées sur des fichiers réels)

```
src/core/      footprints, verdict, collisions, degrees, zones, paths, waves, lifecycle,
               predict, priority, notices, types(-domain/-runtime)   → domaine pur
src/services/  declare, ingest, resolve, planning, learning, notices, reservations,
               predict-llm, width, ctx, tokens, maintenance, shared
src/storage/   interfaces.ts, schema.ts + forge/ (14 tables) + memory/ (même interface)
src/glue/      triggers, resolvers-mcp, ui-data, status, demo routes
src/simulation/ run, scenarios        src/ui/  src/i18n/
site/          index.html, styles.css, demo/main.ts, demo/world.ts, demo/sections/, dist/
templates/     ci/, hook/, mcp-bridge/, opencode/, skill/, watcher/
skills/avoid-collisions/   prompts/   scripts/ (prove.py, check-manifest.mjs,
               check-site-bundle.mjs, deploy-site.sh, seed-jira-demo.py, smoke-e2e.sh)
tests/ (36 fichiers)   docs/ (SPEC 42 Ko, ARCHITECTURE, CONTRACTS, DEPLOY, IDEAS,
               JUDGES, MCP-BRIDGE, OPENCODE, PROTOCOL, PROOFS, VIDEO-SCRIPT, WATCHER)
manifest.yml   rovo:mcp (16 outils) + modules action/resolver/trigger/webtrigger/
               issuePanel/dashboardGadget + scheduled jobs
```

## 3. Doublons et frictions déjà connus (exploite-les, mais ne t'y limite pas)

1. **Deux implémentations de stockage** (`src/storage/memory` vs `src/storage/forge`) pour la même
   interface : même logique métier dupliquée, dérive possible.
2. **Moteur dupliqué côté site** : `site/demo/world.ts` rejoue un moteur proche de
   `src/simulation` + `src/core`, en plus du chemin « live ».
3. **Trois chemins d'observation** (hook Claude Code, watcher local, pont MCP) + CI : même
   notion d'emprise, code et formats distincts.
4. **Verdict reformaté** à plusieurs endroits (core, site, MCP, prompts, notifications).
5. **16 outils MCP** dont beaucoup se recouvrent (`check-zone` / `who-touches` / `get-worksite` /
   `list-collisions` / `list-clear-work`…).
6. **Docs qui se recopient** : SPEC (42 Ko), ARCHITECTURE, CONTRACTS, JUDGES, VIDEO-SCRIPT,
   PROTOCOL, MCP-BRIDGE, OPENCODE, WATCHER, DEPLOY.
7. **Scénario « four agents »** dupliqué entre `tests/fixtures`, `src/simulation/scenarios.ts`,
   `site/demo` et la vidéo.
8. **Jetons** gérés à plusieurs endroits (services/tokens, .chantier/hook.sh, watcher, CI, bridge).
9. **Manifest vs code** : 16 outils déclarés à la main, vérifiés par `scripts/check-manifest.mjs`.
10. **i18n FR/EN** partiel, duplication de libellés entre site, UI Forge et docs.
11. **Docs/IDEAS.md** contient déjà 100 idées *fonctionnalités* : ne pas les recopier ; si tu y
    touches, c'est pour les **consolider** (les fusionner, les prioriser, en supprimer).
12. Règles maison : fichiers < 500 lignes, fonctions < 50 lignes, zéro duplication, CI ≤ 5 min.

## 4. Mission

Produire **100 idées de consolidation** pour ce dépôt — c'est-à-dire des actions qui **fusionnent,
relient, simplifient, suppriment, unifient, ou re-cadrent** l'existant (code, docs, surfaces,
données, CI, récit, écosystème). **Pas de nouvelle fonctionnalité** : si une idée ajoute un
composant au lieu d'en fusionner deux, elle n'entre pas (type `add` = hors sujet).

Critères de qualité d'une idée :
- **concrète** : elle nomme des fichiers, modules, fonctions ou sections précis (`src/core/verdict.ts`,
  `src/storage/memory/`, `docs/SPEC.md §7`, `manifest.yml tools:`, `scripts/prove.py`) ;
- **actionnable** : on sait quoi faire dans la journée ;
- **vérifiable** : on sait comment on saura que c'est fait ;
- **priorisée** : impact 1-5, effort en jours (0.5 à 15), risque low/med/high ;
- **non redondante** : unique dans ton lot ; relis `docs/IDEAS.md` pour éviter de reproposer un
  backlog déjà écrit.

Au moins **60 idées sur 100** doivent être de type `merge` / `unify` / `delete` / `simplify` /
`unwedge` / `document` / `pivot` (c'est le cœur de la demande) ; les 40 autres peuvent être des
`refactor` de fond ou des `guard` (garde-fous anti-dérive) qui empêchent le retour du doublon.

## 5. Format de sortie (impératif)

Un seul fichier, **TSV** (tabulation), écrit dans `docs/consolidation/data/partie-NN.tsv`
(NN = ton numéro de partie, 01→10). Aucun autre fichier modifié, aucun commit, aucun push.

En-tête exact (une ligne) :

```
id	famille	type	titre	surface	impact	effort_jours	risque	description
```

Champs :
- `id` : `P07-001` … (NN de ta partie), unique.
- `famille` : ta famille assignée (slug en minuscules, ex. `docs-sprawl`).
- `type` : `merge` | `unify` | `delete` | `simplify` | `unwedge` | `document` | `pivot` | `refactor` | `guard`.
- `titre` : ≤ 70 caractères, verbe d'action, français.
- `surface` : `code` | `docs` | `site` | `ops` | `data` | `story` | `ecosystem` | `tests` | `ci`.
- `impact` : entier 1-5.
- `effort_jours` : nombre décimal (0.5, 1, 2, 3, 5, 8, 15).
- `risque` : `low` | `med` | `high`.
- `description` : **une seule phrase**, ≤ 200 caractères, sans tabulation ni saut de ligne,
  nommant le(s) fichier(s) ou section(s) concerné(s).

Règles de saisie : **aucun caractère tab** dans un champ, aucun saut de ligne dans un champ,
pas de guillemets, pas de `;` comme séparateur (les tabs suffisent), accents autorisés.

## 6. Vérification avant de rendre (obligatoire)

```bash
awk -F'\t' 'NR>1 && NF!=9 {print NR": "NF}' docs/consolidation/data/partie-NN.tsv   # doit être vide
wc -l docs/consolidation/data/partie-NN.tsv                                          # doit être 101
cut -f2 docs/consolidation/data/partie-NN.tsv | sort | uniq -c                     # répartition des familles
```

Si une ligne a un mauvais nombre de colonnes, corrige-la. Rends **exactement 100 idées**.

## 7. Interdits

- Ne modifie aucun fichier hors `docs/consolidation/data/partie-NN.tsv`.
- Pas de `git commit` / `git push` / `git checkout` / branch.
- Pas de délégation à un autre agent : fais le travail toi-même.
- Pas de réseau inutile, pas de déploiement, pas de commande destructive.
- Tu peux **lire** tout le dépôt (docs, src, templates, scripts, tests) : c'est la source de vérité.

## 8. Rendu final à l'agent parent

Réponds en **3 lignes maximum** :
```
fichier: docs/consolidation/data/partie-NN.tsv
idées: <n> (dont <n> de type merge/unify/delete/simplify)
contrôle: wc -l = <n> · colonnes invalides = 0
```
