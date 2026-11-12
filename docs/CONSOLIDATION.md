# CONSOLIDATION — les 10 idées à faire en premier

> Généré le 2026-11-12 à partir de **1000 idées de consolidation** (999 uniques après
> déduplication), produites par 10 agents en parallèle puis agrégées par
> `scripts/consolidate.mjs`. Détail complet : `docs/consolidation/IDEES-1000-{1,2,3}.md`
> et le jeu de données `docs/consolidation/data/all.tsv`. Méthode en fin de fichier.

## Pourquoi « consolidation » et pas « fonctionnalités »

Le dépôt a déjà dépassé le point où il « marche » : 88 fichiers de code, 36 fichiers de
tests, 12 documents, 16 outils MCP, 3 façons d'observer une emprise, 2 implémentations de
stockage. La menace numéro un avant le jugement (22/12) n'est plus de manquer une feature,
c'est la **dérive** : deux endroits qui disent la même chose finissent par se contredire, et
un juge qui suit deux chemins voit deux résultats. Consolider = faire en sorte qu'un fait ne
vive qu'à un seul endroit.

Les 10 ci-dessous sont ceux qui, faits en premier, retirent le plus de doublons pour le moins
d'effort, et sécurisent la promesse « le site EST le déploiement ».

## Top 10

### 1. Une porte d'entrée unique : `npm run verify`
**Sources** : P07-002, P07-021 · merge · impact 5 · ~1-2 j · risque low
La CI, `deploy-site.sh`, `prove.py` et la doc relistent chacun leur propre enchaînement de
contrôles (lint, typecheck, manifest gate, tests, bundle du site). Un seul `scripts/verify.mjs`
les enchaîne et tous l'appellent.
**Premier pas** : écrire `scripts/verify.mjs` qui invoque `npm run lint && tsc --noEmit &&
check-manifest && vitest && check:site`, puis le câbler dans la CI et `deploy-site.sh`.
**Fini quand** : une seule ligne `npm run verify` dans la CI, le runbook et les preuves.

### 2. Un catalogue unique des 16 outils MCP
**Sources** : P03-011, P07-009 · unify · impact 5 · ~1-2 j · risque low
La liste des outils vit en 4 exemplaires : `manifest.yml`, `scripts/check-manifest.mjs`
(`EXPECTED_TOOLS`), le tableau du README et le compteur `16` de `prove.py`. Un module
`src/glue/tool-catalog.ts` devient la seule source, les autres le lisent (ou sont générés).
**Premier pas** : extraire `tool-catalog.ts`, faire pointer `check-manifest.mjs` dessus, puis
générer la section `rovo:mcp` du manifest (`scripts/gen-manifest.mjs`, P03-052).
**Fini quand** : ajouter un outil ne se fait qu'à un seul endroit.

### 3. Réconcilier les deux stores (la parité métier)
**Sources** : P02-002, P02-018, P02-092, P02-020 + garde P02-066 · unify · impact 5 · ~3-4 j · risque med
`memory/` et `forge/` **divergent sur la logique de verdict** : le rang delete/rename diffère
(donc la détection D3 diffère), `resolve` écrase la résolution côté forge mais pas côté mémoire,
la fusion d'empreinte ne garde pas le même `firstAt`, et `findOverlapping` ne balaie pas le même
périmètre. C'est le doublon le plus dangereux : deux backends, deux résultats.
**Premier pas** : porter les règles (`SOURCE_RANK`, `MODE_RANK`, fusion, `findOverlapping`) dans
`src/core/footprints.ts` et faire appeler les deux stores par ce noyau.
**Fini quand** : `scripts/check-storage.mjs` (P02-066) passe en CI et prouve la parité sur les
cas limites ; les tests `tests/storage` n'ont plus de branches spécifiques à un backend.

### 4. `docs/INDEX.md`, index unique ; README réduit à l'entrée
**Sources** : P06-015, P06-029 · merge · impact 5 · ~1 j · risque low
Douze fichiers de doc sans table des matières : le juge ne sait pas où commencer, et chaque fait
(parcours, protocole, runbook) est raconté plusieurs fois. Un index unique + un README court
(résumé, démo live, 4 parcours en une ligne, commandes dev) recentrent la lecture.
**Premier pas** : écrire `docs/INDEX.md` (un document, une audience, un rôle), y renvoyer depuis
le README qui perd ses sections dupliquées.
**Fini quand** : `docs/INDEX.md` est le seul point d'entrée de la doc ; JUDGES/DEPLOY/PROTOCOL ne
recopient plus un fait d'une autre doc.

### 5. `docs/PITCH.md` : le pitch (FR + EN) en une seule source
**Source** : P09-001 · merge · impact 5 · ~1 j · risque low
Le pitch est recopié dans README, `site/index.html`, `docs/VIDEO-SCRIPT.md` et (à venir) le texte
Devpost. Une source unique référencée partout garantit que le juge, la vidéo et la page racontent
la même chose.
**Premier pas** : créer `docs/PITCH.md` (pitch FR de SPEC §1 + traduction EN), faire pointer les
quatre surfaces dessus.
**Fini quand** : une correction du pitch se propage partout sans retouche manuelle.

### 6. Le site devient la porte d'entrée unique des juges
**Sources** : P09-020, P09-021 · pivot/delete · impact 5 · ~1 j · risque med
Aujourd'hui README, JUDGES et le site donnent trois départs différents. Un bandeau « Start here »
sur le site (playground, données live, scénario) en fait le départ unique ; README et JUDGES
deviennent des listes de liens, et JUDGES ne renvoie plus vers des écrans non déployés.
**Premier pas** : ajouter le bandeau « Start here », recaler la Route 0 de JUDGES dessus, retirer
les renvois aux écrans commentés du manifest.
**Fini quand** : un juge arrive sur le site et n'a plus besoin de lire le README pour se lancer.

### 7. Une table d'erreurs unique du domaine
**Source** : P10-010 · unify · impact 5 · ~1-2 j · risque low
Les `throw new Error` dispersés dans `src/services` et `src/glue` portent des messages libres.
`src/core/errors.ts` regroupe des codes stables, repris par l'UI, les outils MCP et les logs.
**Premier pas** : créer `errors.ts` (codes + messages), remplacer les 13 `throw` libres.
**Fini quand** : aucun `new Error("...")` en dur hors de `errors.ts` ; les clients lisent un code.

### 8. Désdupliquer le noyau de détection / verdict
**Sources** : P07-037, P07-001, P07-020 · merge/unify · impact 5 · ~2-3 j · risque med
`detectForSubject` (declare) et `detectAndVerdict` (ingest) refont la même séquence ; la
modulation des degrés existe en double (`modulate()` vs une seconde échelle dans `collisions.ts`) ;
`SOURCE_RANK`/`MODE_RANK` sont recopiés trois fois. Un noyau partagé supprime ces chemins jumeaux.
**Premier pas** : extraire une fonction de détection unique dans `services/shared.ts`, exporter
`modulate()` et les rangs depuis `core/` pour que tout le monde les importe.
**Fini quand** : `grep -r` ne trouve plus de deuxième implémentation de la modulation ni des rangs.

### 9. Un noyau d'observation partagé (hook, watcher, OpenCode, CI)
**Source** : P05-002 · unify · impact 5 · ~2 j · risque low
Le watcher, le plugin OpenCode et les gabarits CI construisent chacun leur corps de requête
`/open` `/touch` `/close`. Les brancher sur un constructeur commun (`chantiers-lib` / un
template unique) élimine la troisième copie du protocole d'émission d'emprise.
**Premier pas** : extraire `buildOpenBody/buildTouchBody/buildCloseBody` et faire les trois clients
appeler ces fonctions.
**Fini quand** : la forme des payloads ne vit qu'à un seul endroit, testée une seule fois.

### 10. Imposer les contrats en base : indexes uniques + garde-fou
**Sources** : P02-041, P02-042 · simplify · impact 5 · ~1 j · risque med
La clé métier « une collision par (repo, worksite_a, worksite_b, zone) » et « une footprint par
(worksite, path) » est une règle du contrat mais n'est pas imposée en SQL. Des indexes uniques la
font respecter par la base, pas par la discipline.
**Premier pas** : ajouter les deux indexes uniques dans `src/storage/schema.ts`, déployer, faire
passer le seed.
**Fini quand** : un doublon est rejeté par la base et non plus toléré silencieusement.

## Ce qu'on ne fait **pas** en premier

Les `guard`, `refactor` et `pivot` de niche (i18n complet, génération du site depuis un script,
renommage `/demo/*` en `/public/*`) passent **après** les 10 ci-dessus : ils n'empêchent aucune
dérive tant que les sources uniques ci-dessus ne vivent pas encore.

## Méthode (reproductible)

1. **Génération** : 10 agents en parallèle, chacun 100 idées sur une famille donnée
   (core-domain, storage-dual, glue-mcp, site-demo, observation, docs-sprawl, proofs-ops,
   data-tests, story-ecosystem, cross-cutting), ancrées dans le code réel (fichiers, fonctions,
   sections de spec nommés).
2. **Format** : TSV, 9 colonnes `id · famille · type · titre · surface · impact · effort_jours ·
   risque · description` ; contrôlé par `awk` (NF=9) et `wc -l` (101).
3. **Agrégation** : `node scripts/consolidate.mjs` — déduplication par similarité Jaccard (seuil
   0.82) sur les titres normalisés, score `impact*3 - effort*0.8 + pondération(type) -
   pénalité(risque)`, puis shortlist du top 60.
4. **Sélection** : les 10 retenus équilibrent impact immédiat (avant le 22/12) et structure
   (zéro duplication, un fait = un endroit), en couvrant les 10 familles.

## Répartition

| type | n | | surface | n |
|---|---|---|---------|---|
| unify | 299 | | code | 289 |
| merge | 150 | | tests | (voir stats.md) |
| simplify / guard / delete / document / pivot / refactor / unwedge | ~550 | | docs, ci, ops, data, site, story, ecosystem | — |

Le détail par famille/type/surface est dans `docs/consolidation/data/stats.md`.

## À lire

- `docs/consolidation/IDEES-1000-1.md`, `…-2.md`, `…-3.md` — les 999 idées groupées par famille.
- `docs/consolidation/data/all.tsv` — le jeu de données complet (tab-séparé).
- `docs/consolidation/BRIEF.md` — le brief donné aux agents (contexte + format + contrôle).