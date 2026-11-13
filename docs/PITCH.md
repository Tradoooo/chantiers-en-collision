# PITCH — le pitch, en une seule source

> Source unique du pitch. Repris **verbatim** de `docs/SPEC.md` §1.
> Ne le recopie plus ailleurs : corrige-le ici, les autres surfaces suivent.
>
> **Où ce texte est utilisé : README, site/index.html, VIDÉO-SCRIPT, texte Devpost.**

## FR — la phrase

> Jira sait à chaque instant qui travaille sur quelle partie du code, personnes et agents
> confondus : chaque travail en cours a une emprise sur le dépôt, tout chevauchement est
> signalé avant la première ligne écrite, et l'app dit quoi faire — attendre, se coordonner,
> découper, ou lancer en parallèle sans risque.

## EN — the same sentence

> Jira knows, at every instant, who is working on which part of the code — people and agents
> alike. Every work in progress has a **footprint** on the repository. Every overlap is
> flagged **before the first line is written**, and the app says what to do: wait,
> coordinate, split, or run in parallel safely.

## Notes d'usage

- Le README n'en garde qu'**une ligne** et pointe ici ; le site en garde la version EN dans
  son bandeau « Start here » ; la vidéo (docs/VIDEO-SCRIPT.md) et le texte Devpost la
  citent telle quelle.
- Le reste du récit (problème, degrés, verdicts) vit dans `docs/SPEC.md` — pas ici.

## Glossaire — un seul vocabulaire (EN ↔ FR)

> Le produit alterne l'anglais (code, site, pitch EN) et le français (spec, récit).
> On ne traduit pas au hasard : chaque concept a **un** mot par langue, employé
> partout. Ce tableau est la référence ; une nouvelle doc le cite au lieu de réinventer.

| Concept | English (code, site) | Français (spec, récit) | Sens en une ligne |
|---|---|---|---|
| The unit of work | **worksite** | **chantier** | un travail en cours sur un ticket (état, PR, session) |
| The surface it will touch | **footprint** | **emprise** | la liste des chemins qu'un chantier va écrire |
| Two footprints overlapping | **collision** | **collision** | un chevauchement détecté entre deux chantiers |
| Severity of a collision | **degree** (D0–D5) | **degré** | 0 = rien · 1–2 = toucher · 3 = ordonner · 4 = réserver · 5 = multiplier |
| What to do | **verdict** (`free`/`caution`/`wait`/`stop`) | **verdict** | la décision rendue : libre, prudence, attendre, stop |
| A zone held for a while | **reservation** | **réservation** | une zone réservée par un chantier, avec expiration |
| A named part of the repo | **zone** | **zone** | une partie du dépôt et son comportement (exclusive, hotspot…) |
| A message to neighbours | **notice** | **avis** | ce qu'un chantier dit aux chantiers voisins |
| A person or an agent at work | **actor / session** | **acteur / session** | qui travaille, depuis quelle machine |
