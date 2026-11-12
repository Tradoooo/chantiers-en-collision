# CONSOLIDATION — vague 2 : les 10 suivantes

> Généré le 2026-11-12, **après** la vague 1 (les 10 idées de [`docs/CONSOLIDATION.md`](CONSOLIDATION.md),
> toutes implémentées et déployées). 100 idées neuves, produites par 5 agents en
> parallèle sur l'état réel du dépôt, puis agrégées par `scripts/consolidate.mjs`.
> Détail brut : `docs/consolidation/data/v2/all.tsv` · top 40 : `…/v2/shortlist.tsv` ·
> stats : `…/v2/stats.md`.

## Pourquoi une seconde vague

La vague 1 a réglé les doublons **structurants** (rangs, détection, erreurs, porte d'entrée,
catalogue des outils, noyau d'observation, index de doc, pitch). Ce qui reste ne se voit pas
dans l'architecture : ce sont des **dérives d'un jour à l'autre** — un délai annoncé qui n'est
plus le vrai, un compteur recopié à la main, un site qui affiche une couleur au lieu du verdict
réel, un script qui marche parce qu'un vieux dossier traîne dans `dist/`.

Deux des dix ci-dessous sont des **bugs visibles par un juge** ; les huit autres empêchent la
dérive de revenir.

## Les 10 meilleures

### 1. `build:site` doit produire la vidéo — sinon un checkout propre publie un site sans elle
**V2-A-011** · simplify · impact 4 · ~0,5 j · risque low
`npm run build:site` copie `index.html` et `styles.css` dans `site/dist/` mais **pas `site/assets/`**.
Aujourd'hui la vidéo est en ligne parce qu'un vieux `site/dist/assets` traîne dans le dossier ;
un clone neuf, une build neuve, et la démo se publie **sans la vidéo** (la preuve P10 tombe).
Ajouter `cp -r site/assets site/dist/` au script.
**Fini quand** : `rm -rf site/dist && npm run build:site` produit un `site/dist/` qui contient
`assets/demo.mp4`.

### 2. La carte du verdict live est toujours peinte « caution »
**V2-A-003** · simplify · impact 4 · ~0,5 j · risque low
`liveVerdictCard()` (site/demo/main.ts) force la classe `verdict-caution` : le site écrit
« verdict : wait » mais l'affiche en jaune « caution ». Appliquer le verdict réellement renvoyé
par `/demo/verdict` (`free` / `caution` / `wait` / `stop`).
**Fini quand** : un verdict `free` arrive en vert, un `wait` en rouge.

### 3. Une seule table des délais d'observation
**V2-C-008** · unify · impact 4 · ~1 j · risque low
Le watcher attend 10 s, le plugin OpenCode 3 s, et `docs/WATCHER.md` annonce 3 s. Exporter les
délais depuis `templates/chantiers-lib/payload.mjs` (la source unique qui existe déjà) et les
documenter une fois.
**Fini quand** : la doc et les deux clients lisent la même constante.

### 4. Étiqueter chaque section : « déploiement réel » ou « monde local »
**V2-A-010** · unify · impact 4 · ~1 j · risque low
Le site affiche les worksites du déploiement en table **et** la carte du monde local en arbre,
sans dire lequel est lequel. Un bandeau de source par section (le même que le badge
« LIVE · deployment ») — c'est la promesse « le site EST le déploiement », sans zones grises.
**Fini quand** : chaque section dit de où viennent ses données.

### 5. Un chargeur de secrets unique
**V2-D-003** · unify · impact 4 · ~1 j · risque low
`.tokens/personal.json`, `.tokens/project.json`, `~/.atlassian-login`, `~/.atlassian-api-token`
sont relus à plusieurs endroits (`prove.py`, `seed-jira-demo.py`, `smoke-e2e.sh`). Un module
`tokens` unique, avec surcharge d'environnement.
**Fini quand** : un seul fichier sait où sont les jetons.

### 6. Le compte « 16 outils » vient du catalogue
**V2-D-008** · unify · impact 4 · ~1 j · risque low
`prove.py` (P7) compte les outils en dur ; `src/glue/tool-catalog.ts` est déjà la source unique
(depuis la vague 1). Lire le catalogue : ajouter un 17e outil ne peut plus rendre la preuve
fausse.
**Fini quand** : la preuve lit le nombre au lieu de l'écrire.

### 7. Une seule source des URLs de déploiement
**V2-D-002** · unify · impact 4 · ~1 j · risque low
`WEBTRIGGER`, `MCP_ENDPOINT`, `SITE` sont en dur dans `prove.py` et dans la doc — c'est
précisément le piège du transfert de repo rencontré ce soir. Un fichier de config (ou des
variables d'environnement) lu par les deux.
**Fini quand** : changer d'URL se fait à un seul endroit.

### 8. Achever la bascule vers `core/errors.ts`
**V2-B-016** · unify · impact 4 · ~1 j · risque low
Les services sont migrés ; `src/glue` (`resolvers-mcp`, `webtrigger`) lève encore des erreurs
éparses. Un client MCP doit lire un **code** stable, pas un texte.
**Fini quand** : plus aucun `new Error("...")` libre dans `src/`.

### 9. Le `touch` passe par `hook.sh` : un seul script pour `open`/`touch`/`close`
**V2-C-013** · merge · impact 5 · ~2 j · risque med
`templates/hook/settings.json` poste l'événement `PreToolUse` **brut** alors que `open` et
`close` passent par `hook.sh` : trois chemins pour trois verbs. Faire passer le touch par le
même script (le noyau `payload.mjs` sait déjà construire le corps).
**Fini quand** : le hook et le watcher envoient le même corps pour le même événement.

### 10. Un seul client webtrigger (preuves, smoke, pont MCP)
**V2-D-001** · unify · impact 5 · ~2 j · risque low
`prove.py`, `smoke-e2e.sh` et le pont MCP réimplémentent chacun le POST `/open` `/touch`
`/close` — trois copies du protocole, trois façons de se tromper (et c'est la troisième qui
ignorait le cold start). Une fonction `wt()` unique, réutilisée par les trois.
**Fini quand** : le protocole d'émission est écrit une fois.

## La suite (20–40) en un coup d'œil

| # | Idée | Famille |
|---|---|---|
| 11 | Un module de constantes narratives (`core/constants.ts`) | moteur |
| 12 | Une seule fabrique du moteur (`buildEngine()`) | moteur |
| 13 | Un seul point d'entrée de prédiction (heuristique **et** LLM) | moteur |
| 14 | Un seul jeu de données seed (script + site + simulation) | données |
| 15 | Dicts i18n uniques (FR/EN) | moteur |
| 16 | Un seul scénario « 4 agents » (fixture = source) | moteur |
| 17 | Un `postJson` commun (délai + relance) pour tous les clients | clients |
| 18 | Centraliser les durées de vie dans `core/lifecycle.ts` | moteur |
| 19 | Une seule table des natures de zone | moteur |
| 20 | Un seul helper de temps (`core/time.ts`) | moteur |
| 21 | Un seul contexte `Ctx` | moteur |
| 22 | Un `parseHookResponse` dans le noyau partagé | clients |
| 23 | Une seule source des « 16 outils » pour le README et les preuves | ops |
| 24 | Un glossaire unique emprise/chantier/collision | récit |
| 25 | Un schéma des 14 tables en une page | données |

## Méthode

1. **5 agents × 20 idées**, chacun sur une famille : `site-public`, `moteur`, `clients`,
   `forge-ops`, `donnee-recit` — en partant de l'état **après** la vague 1 (`git log -6`),
   sans jamais reproposer les 10 déjà faites.
2. **Format** : TSV 9 colonnes, contrôlé (`awk` NF=9, `wc -l`).
3. **Agrégation** : `node scripts/consolidate.mjs --dir docs/consolidation/data/v2 --out docs/consolidation/data/v2 --top 40`
   → déduplication Jaccard 0,82, score `impact*3 − effort*0,8 + type − risque`.
4. **Sélection** : les 10 retenues classent d'abord ce qu'un **juge** verrait (couleur du
   verdict, vidéo manquante, source des données), puis ce qui empêche la dérive de revenir.

## À lire

- `docs/consolidation/data/v2/all.tsv` — les 100 idées (tab-séparé).
- `docs/consolidation/data/v2/shortlist.tsv` — le top 40.
- `docs/consolidation/data/v2/stats.md` — répartition par famille / type / surface.
