# 100 idées pour aller plus loin — backlog brut

> Généré le 11 novembre 2026. Référence : docs/SPEC.md (numéros § entre parenthèses).
> Le **top 10** est en tête ; les 100 idées suivent, groupées par thème.
> Priorité implicite : la soumission Codegeist est le **22 décembre 2026, 21 h (Paris)**,
> gel des fonctionnalités le 15 décembre (§25).

## 🏆 Top 10 (impact × faisabilité avant le 22 décembre)

| # | Idée | Pourquoi |
|---|------|----------|
| 1 | **Déployer sur un vrai site Forge** (`forge create` + `forge deploy`, EAP rovo:mcp, exposition externe MCP activée admin) — idées 1-2 | Sans ça, AUCUN des 4 parcours juges (§24) n'est testable. C'est le déblocage de tout le reste : panneau, carte, console, agent Rovo, outils MCP externes. |
| 2 | **Repo d'exemple public `acme/billing-demo`** avec hook.sh + settings.json pré-remplis, étape de CI, scripts curl et jeton projet de démo — idées 3-4 | Parcours juges 3 et 4 « clés en main » : clone → renseigne le jeton → lance deux sessions. Dix minutes de travail, effet démo décisif. |
| 3 | **La vidéo de soumission (< 5 min, anglais)** sur site réel, storyboard §23 déjà écrit — idée 5 | Obligatoire pour Devpost. Tout existe déjà (storyboard, démo navigateur, site) ; il ne manque que la capture d'un site déployé. |
| 4 | **Fumée E2E sur le site déployé** : workflow post-deploy qui rejoue declare→touch→close en curl + vérifie les points §19 (webtrigger < 1 s, compte MCP transmis) — idée 7 | Assurance anti-jour-J + cela valide d'un coup les 8 « points à valider » du §19 qui fondent l'architecture. |
| 5 | **Dispatcher `next-clear-ticket`** (§27) : l'orchestrateur demande « le prochain ticket libre pour l'agent 3 », l'app tient la file — idée 21 | Le saut « de l'alerte au répartiteur », meilleur différenciateur du lot. Quasi gratuit : `list-clear-work` + réservations existent déjà ; un outil MCP de plus (13 → 14, limite 50). |
| 6 | **Watcher local universel `chantier-watch`** : surveille le worktree (fs events) et envoie /touch — marche pour Cursor, Aider, Copilot, Codex, vim — idée 26 | Répond au point §19 « équivalent des hooks dans les autres clients » et à la critique « dépendance à un seul client ». Un binaire/script, zéro intégration par éditeur. |
| 7 | **Boucle d'apprentissage complète (CC-25)** : précision de prédiction par composant + proposition de reclassement des zones d'après les conflits réels — idées 61-62 | La narration « l'app apprend de ce qui s'est passé » avec des chiffres mesurables ; exigeance S bien vue des juges, données déjà en tables. |
| 8 | **Métrique « largeur parallèle »** : « ce dépôt supporte 3 agents de front ; découper routes.ts en ferait travailler 7 » — idée 52 | Concept neuf et mémorable (vision §27), parlable en 10 secondes dans la vidéo ; se calcule avec planWaves + zones existants. |
| 9 | **Champ « Collisions » sur les cartes du tableau + JQL `collidingWork()` opérationnels (CC-18)** — idées 8, 9 (idées 63 et suivantes pour les tendances) | « Être visible sans ouvrir le ticket » : la visibilité passive est le cœur de la promesse produit ; le customField est déjà au manifest, il faut le câbler et le tester en vrai. |
| 10 | **Protocole ouvert + skill en source ouverte** : publier `open-footprint-protocol` (JSON spec declare/touch/close) et la skill `avoid-collisions` dans un repo dédié — idées 95, 34 | Vise les bonus Marketplace/écosystème et positionne le projet au-delà du hackathon (« un réflexe commun à tous les agents, quel que soit l'éditeur », §27). |

## Les 100 idées

### A. Hackathon & soumission (1-12)
1. Déployer l'app sur un site Forge de démo (app id réel, `forge deploy`, `forge lint` officiel).
2. Activer l'EAP rovo:mcp + l'exposition externe OAuth 2.1 (admin Atlassian) pour les clients MCP tiers.
3. Repo d'exemple public `acme/billing-demo` (code factice + hook + CI + README juge).
4. Scripts curl des parcours 3-4 pré-remplis (URL webtrigger réelle, jeton projet de démo).
5. Vidéo < 5 min en anglais, storyboard §23, capturée sur le site réel.
6. Texte Devpost : pitch, problème, démo, architecture, « comment tester », en anglais.
7. Workflow de fumée E2E post-deploy (declare/touch/close/reserve en curl, assert sur les verdicts).
8. Créer le customField « Collisions » sur le site démo, renseigner `CHANTIERS_COLLISIONS_FIELD_ID`.
9. Icône + vignettes des modules Jira (requis manifest : issuePanel, dashboardGadget).
10. Doc « monter votre propre site de démo en 10 minutes » (pour les juges curieux et le Marketplace).
11. Geler les fonctionnalités le 15 décembre (§25), semaine 16-22 = recette/vidéo/polish uniquement.
12. Plan B hors Forge : mode local (serveur node + stores mémoire) si le site Cloud tousse le jour J.

### B. Expérience juges & démo (13-20)
13. Mode « visite guidée » de la console de simulation : narration pas à pas du scénario Four agents.
14. Bascule FR/EN instantanée de toute l'UI (les dicts i18n existent déjà).
15. Bouton « reset demo » qui vide les tables de l'installation de démo.
16. Jeu de données réaliste pré-généré sur le site démo (8-10 chantiers vivants, avis, réservations).
17. Carte des chantiers en vrai rendu arbre (SVG) coloré par occupation, au lieu d'une Table.
18. Scénarios de simulation partageables par URL (état encodé en query string).
19. Panneau « pourquoi ce verdict ? » : montre les modulations appliquées (−1 hotspot, −1 dormant, plafonné prédit).
20. JUDGES.md illustré : captures des 4 parcours avec les sorties exactes attendues.

### C. Agents & MCP (21-34)
21. Outil MCP `next-clear-ticket` : le répartiteur de la vision §27 (file tenue par l'app).
22. Variante hook à cache local (§9.3) : script qui n'appelle /touch qu'à la 1re modification par fichier.
23. Équivalent hook pour Cursor (règles + script de surveillance).
24. Wrapper Aider : pre/post-command qui déclare et ferme le chantier.
25. Intégration GitHub Copilot CLI / Codex via le watcher (26).
26. **Watcher local universel** `chantier-watch` : fs events sur le worktree → /touch, pour tout client.
27. Sous-chantiers (CC-23, lot S) : SubagentStart ouvre un lot S rattaché au chantier parent.
28. Verdict « wait » qui propose directement un ticket alternatif (intégration list-clear-work dans la réponse).
29. Emprise étendue aux symboles déclarés (fonctions/API exportées) → prépare D5 (CC-26).
30. Ressource MCP lecture seule exposant la carte des chantiers (pour Rovo/Claude).
31. Prompt MCP « start-work » : enchaîne declare + lecture des avis + voisinage en un appel.
32. Valider §19 : le compte est-il bien transmis en appel MCP externe OAuth ? (sinon jeton personnel).
33. Réputation d'agent : écarts déclarés/observés par client et session (table event existe).
34. Publier la skill `avoid-collisions` en repo ouvert indépendant (clients qui lisent des fichiers skills).

### D. Détection & degrés (35-44)
35. D5 contrats rompus (CC-26) : un chantier change un symbole, les consommateurs sont prévenus sans fichier commun.
36. Extraction AST légère (ts/py/go) des symboles exportés, exécutée par l'étape de CI.
37. Collisions inter-dépôts (CC-27) via les contrats partagés (openapi*, proto, paquets publiés).
38. Renommage de dossier : couverture ancien+nouveau chemin + avis automatique à tous les présents (§21).
39. Degré configurable par zone (monter un fichier critique de D2 à D3).
40. Option « grouper les alertes d'un même pilote » (une seule notification, déjà prévu §7 — l'exposer).
41. Gel validé par un responsable au-delà du seuil de fichiers (§20 équité) : demande → approbation.
42. Historique des collisions par chemin : « ce fichier a collisionné 12 fois ce trimestre ».
43. Réservations mortes : déclaration jamais touchée → proposition de libération anticipée.
44. Croiser CODEOWNERS/fichiers protégés : prudence renforcée + reviewer prévenu.

### E. Planification & vagues (45-52)
45. Règle d'automatisation Jira : publication du plan de vagues en commentaire à l'ouverture du sprint.
46. Vagues datées : ETA × tickets → calendrier de sprint réaliste (« vague 2 jeudi 14 h »).
47. Extraction automatique des charnières en tickets « faire en premier » (brouillons pré-remplis).
48. File d'attente par zone exclusive : ordre de passage + notification à la libération (déjà prévu §8, l'UI).
49. What-if : « si PROJ-88 glisse de 2 jours, que deviennent les vagues ? ».
50. Détection des charnières AVANT le sprint via historique des composants (prédiction × graphe).
51. Notification Slack/Teams à chaque lancement de vague (webhook sortant).
52. **Largeur parallèle** : note « agents de front max » par dépôt + simulation d'impact des refactors.

### F. Humains sans agent (53-60)
53. Publier l'étape GitHub Actions sur le Marketplace Actions (attested footprint en 1 ligne).
54. Composant GitLab CI + snippet Bitbucket Pipelines publiés (templates existent).
55. App compagne Bitbucket (CC-22 lot S) : push/PR → attested + état review sans toucher la CI.
56. Compagnon GitHub minimal (webhook) : PR ouverte → review, merge → closed, fichiers → attested.
57. Hook git pre-push local : envoie l'emprise constatée sans CI (pour les dépôts sans pipeline).
58. Extension VS Code/JetBrains : voisins et verdict dans la gutter de l'éditeur (who-touches).
59. Déclaration par Slack/email : « je travaille sur PROJ-88, src/billing » → chantier ouvert.
60. CLI `chantiers` (declare/check/who/close) pour les humains qui vivent dans un terminal et les scripts.

### G. Apprentissage & métriques (61-68)
61. Précision de prédiction par composant, affichée avec la confiance (§13, CC-25).
62. Reclassement proposé des zones d'après les conflits réels (jamais → hotspot ; toujours → exclusive).
63. Tendances hebdo des quatre chiffres (gadget dashboard avec sparklines).
64. Rapport hebdo par email/Rovo : collisions manquées, reclassements proposés, largeurs parallèles.
65. Suivi des « passer outre » : le conflit réel a-t-il suivi ? (prévu §8 — l'instrumenter).
66. Statistiques par acteur (anonymisées, agrégées équipe) : qui collisionne, qui déclare bien.
67. Time-to-resolution par degré : durée réelle des wait D4 (mesure de la friction).
68. Compteur « collisions évitées » : la métrique positive du produit (vue avant → pas de conflit).

### H. Notifications & avis (69-74)
69. Accusé de remise d'avis à l'auteur (« Léa a lu votre avis »).
70. Fil commun Jira : commentaire @mentionnant les deux pilotes sur « se coordonner » (§8).
71. Avis à TTL : « ne touchez pas à auth/ avant 15 h » → expire et libère automatiquement.
72. Résumé SessionEnd : ce qui s'est passé sur vos chemins pendant la session.
73. Canal Slack/Teams #collisions pour les événements D3+ (option projet).
74. Escalade tech lead : D4 non résolu depuis > 2 h → notification (prévu §8 « arbitre »).

### I. Gouvernance & sécurité (75-81)
75. Mode dur par zone (et pas seulement par projet) : « migrations toujours dur ».
76. UI du journal d'audit : qui a réservé, passé outre, gelé, quand (table event existe).
77. Demandes de gel avec approbation responsable (§20 équité, au-delà du seuil).
78. Rotation et expiration des jetons (90 jours) + révocation en un clic (réglages perso).
79. Rate-limit par jeton sur le webtrigger (anti-abus, anti-boucle d'agent).
80. Badge/contrat « zéro contenu de fichier » : le test recette 14 exécuté en CI et affiché.
81. Export de conformité par projet (JSON des chantiers/collisions/avis) — RGPD/audit.

### J. Performance & échelle (82-87)
82. Benchmark public : 50 chantiers × 500 chemins < 2 s (point §19) — script + résultat au README.
83. Cache mémoire des zones et règles par installation (Forge SQL : 5 s max par SELECT).
84. Détection en un seul lot de requêtes par déclaration (éviter le N+1 par entrée).
85. Carte paginée/virtualisée pour monorepos (10 k+ chemins).
86. Rétention configurable : purge des chantiers fermés > 90 jours (quota 1 Gio/installation).
87. Sweep incrémental (dépôts actifs seulement) pour rester loin des 900 s du déclencheur.

### K. UI & modules Forge (88-94)
88. Panneau personnel « mes agents en cours » avec pause/arrêt en un clic.
89. Éditeur de zones avec test de motif en direct (« ce chemin → quelle zone ? »).
90. Rejeu temporel de la carte : « qui était où mardi à 14 h ? » (events existent).
91. Gadget tableau de bord avec comparaison semaine précédente.
92. Réglages projet entièrement i18n FR/EN (déjà côté verdicts).
93. Rafraîchissement quasi temps réel de la carte (polling 30 s) pour la démo.
94. Passer la carte + la console en Custom UI React (polish visuel pour la vidéo).

### L. Vision & écosystème (95-100)
95. **Open Footprint Protocol** : spec JSON ouverte (declare/touch/close/verdict) indépendante de Forge.
96. Adaptateurs autres trackers (Linear, GitHub Issues) — vision post-hackathon.
97. Négociation entre agents (§27) : échange d'avis automatique, ordre proposé, l'app arbitre.
98. Chantiers hors code (§27) : pages Confluence, config Jira, environnements de recette exclusifs.
99. « Dette d'architecture = agents qui attendent » : rapport chiffré pour les tech leads (§27).
100. Convergence avec les briefs frères Codegeist (§28) : même hook, même jeton, même point d'entrée (brief 02, permis 06, merge 03, CI 04).
