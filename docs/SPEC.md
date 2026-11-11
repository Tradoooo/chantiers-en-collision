# Chantiers en collision — cahier des charges

> Codegeist 2026 · catégorie **Apps for Software Teams**
> Bonus visés : MCP (principal), Agents Rovo, Marketplace. Teamwork Graph : non visé, voir § 19.
> Version 1 du 11 novembre 2026 · soumission avant le mardi 22 décembre 2026, 21 h (Paris)

## 1. L'idée en une phrase

Jira sait à chaque instant qui travaille sur quelle partie du code, personnes et agents confondus : chaque travail en cours a une emprise sur le dépôt, tout chevauchement est signalé avant la première ligne écrite, et l'app dit quoi faire — attendre, se coordonner, découper, ou lancer en parallèle sans risque.

## 2. Le problème

Deux développeurs qui modifient le même fichier, cela a toujours existé. Ils s'en apercevaient à la fusion, ou avant, parce qu'ils se parlaient.

Ce qui change, c'est le nombre et la nature des intervenants :

- une seule personne lance quatre agents de code en parallèle, chacun dans sa copie de travail ;
- ces copies isolent les fichiers, pas les intentions : aucun agent ne sait ce que font les trois autres ;
- les agents n'assistent pas au point quotidien et ne lisent pas le tableau ;
- ils travaillent vite : en vingt minutes, quatre chantiers ont divergé.

Le résultat se découvre à la fusion :

- deux migrations portent le même numéro ;
- un agent a renommé un service que les trois autres appellent encore ;
- le fichier de verrouillage des dépendances a été régénéré trois fois ;
- deux agents ont écrit chacun leur version de la même fonction utilitaire.

Le conflit est ensuite résolu par un agent qui ne connaît pas l'intention de l'autre. Il garde une version et écrase l'autre : la régression est silencieuse.

Jira sait qui travaille sur quel ticket, mais pas sur quel code. Git sait quel code a changé, mais seulement après le push. Personne ne connaît l'intention au moment où elle compte.

## 3. Utilisateurs

| Qui | Ce qu'il fait | Ce qu'il attend |
|---|---|---|
| Agent de code | Déclare ce qu'il va toucher, lit la réponse | Un verdict net, le nom du voisin, quoi faire à la place |
| Développeur qui pilote plusieurs agents | Lance des agents en parallèle | Que ses propres agents ne se marchent pas dessus |
| Orchestrateur (agent ou script qui répartit le travail) | Distribue des tickets à une flotte | Savoir ce qui peut partir en parallèle et dans quel ordre |
| Développeur sans agent | Travaille sur sa branche | Être visible sans rien installer, être prévenu à temps |
| Tech lead | Arbitre, annonce les grands travaux | Voir les chevauchements, geler une zone pour une refonte |
| Personne qui prépare le sprint | Compose le sprint | Repérer les tickets qui vont se gêner avant de s'engager |

## 4. Vocabulaire du produit

- **Acteur** : une personne, ou une session d'agent. Un agent est toujours rattaché à la personne qui le pilote.
- **Chantier** : le travail en cours d'un acteur, pour un ticket, dans un dépôt.
- **Emprise** : l'ensemble des chemins qu'un chantier touche ou va toucher.
- **Zone** : une partie nommée du dépôt, définie par des motifs de chemins, avec une nature.
- **Ressource exclusive** : une zone où deux chantiers ne peuvent pas coexister (migrations numérotées, fichier de verrouillage).
- **Point chaud** : un fichier que tout le monde modifie (table des routes, traductions). Le chevauchement y est normal.
- **Collision** : le chevauchement de deux emprises, avec un degré de D0 à D5.
- **Verdict** : la réponse de l'app à une déclaration : libre, prudence, attendre, stop.
- **Réservation** : une emprise exclusive, limitée dans le temps.
- **Avis** : un message court d'un chantier à ses voisins.
- **Vague** : un groupe de tickets qui peuvent avancer en même temps sans collision.
- **Ticket charnière** : un ticket dont l'emprise croise celle de beaucoup d'autres, à traiter seul et en premier.

## 5. L'emprise : quatre sources

| Source | D'où elle vient | Quand | Ce qu'elle vaut |
|---|---|---|---|
| **Prédite** | Composant du ticket, tickets semblables déjà fusionnés, texte du ticket | Dès la création, donc au moment de planifier | Une probabilité, jamais bloquante |
| **Déclarée** | Outil MCP `declare-footprint`, ou panneau du ticket | Au démarrage du travail | Une intention |
| **Observée** | Hook du client de l'agent : chaque fichier que l'agent s'apprête à modifier | Pendant le travail, en direct | Un fait, obtenu sans la coopération de l'agent |
| **Constatée** | Liste des fichiers d'une branche, envoyée par la CI ou par l'app compagne Bitbucket | Au push | Un fait, valable aussi pour les humains |

Chaque source couvre l'angle mort des autres :

- le développeur qui ne déclare rien et n'a aucun outil devient visible au push (constatée) ;
- l'agent qui ignore l'outil est vu quand même par le hook (observée) ;
- le ticket que personne n'a commencé a déjà une emprise probable (prédite).

Règles :

- Une emprise est faite de fichiers, de dossiers ou de motifs. Un dossier couvre tout ce qu'il contient.
- Le fait l'emporte sur l'intention. Si l'agent modifie un fichier hors de ce qu'il a déclaré, l'emprise s'élargit, la détection est rejouée et l'écart est noté.
- Chaque entrée garde sa source. Le panneau montre ce qui est supposé, annoncé et avéré.

## 6. Zones et natures

Une zone donne un nom et un comportement à une partie du dépôt.

| Nature | Comportement | Exemples reconnus par défaut |
|---|---|---|
| Ordinaire | La collision dépend du fichier | Tout le reste |
| Exclusive | Un seul chantier à la fois | `**/migrations/**`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `go.sum`, `schema.prisma`, `openapi*.y*ml` |
| Point chaud | Chevauchement attendu, signalé un cran plus bas | `**/routes.*`, `**/locales/**`, `**/i18n/**` |
| Gelée | Grand chantier annoncé : nouveaux chantiers déconseillés ou refusés pendant une période | Refonte de `src/billing/` du 24 au 26 novembre |
| Hors champ | Ignorée | `dist/**`, `**/__snapshots__/**`, `*.generated.*` |

Le catalogue par défaut est appliqué à l'ajout d'un dépôt, puis corrigé par l'équipe. Une zone peut être reliée à un composant Jira : c'est la première base de la prédiction.

## 7. Degrés de collision

| Degré | Situation | Verdict |
|---|---|---|
| D0 | Même zone nommée, fichiers différents | Libre, voisin mentionné |
| D1 | Même dossier | Prudence |
| D2 | Même fichier | Prudence : lire le chantier voisin avant de modifier |
| D3 | Même fichier, et l'un des deux le supprime, le déplace ou le renomme | Attendre, ou se coordonner |
| D4 | Ressource exclusive, zone réservée ou zone gelée | Attendre ; stop si le projet a activé le mode dur |
| D5 | Contrat rompu : un chantier change ce qu'un autre utilise, sans fichier commun | Se coordonner (lot C) |

Ce qui module le degré :

- point chaud : un cran de moins ;
- voisin endormi (aucune activité depuis le délai de dormance) : un cran de moins ;
- emprise seulement prédite d'un côté : plafonnée à D1, avec la mention « probable » ;
- voisin dont la PR est ouverte et approuvée : le verdict conseille d'attendre la fusion, qui est proche.

Deux agents pilotés par la même personne ne bénéficient d'aucune remise : c'est le cas le plus fréquent et le plus coûteux. Seul le destinataire de l'alerte change, puisqu'il n'y a qu'un pilote à prévenir.

## 8. Que faire d'une collision

L'app ne se limite pas à signaler. Chaque collision ouvre six issues.

| Issue | Ce qui se passe |
|---|---|
| **Attendre** | Le chantier entre dans la file de la zone. À la libération, le pilote est prévenu et l'agent reçoit « libre » à son prochain appel. |
| **Séquencer** | Un ordre est fixé : A fusionne, B se rebase ensuite. L'app pose le lien « est bloqué par » entre les tickets et indique à B la branche à lire. |
| **Se coordonner** | Un avis part chez le voisin ; les deux pilotes sont mentionnés sur un fil commun. |
| **Découper** | La partie commune (un renommage, par exemple) sort dans un ticket à part, fait en premier. L'app en prépare le brouillon. |
| **Regrouper** | Même fichier, même but : un seul chantier fait les deux. |
| **Passer outre** | Avec un motif. L'app regarde ensuite si un conflit réel a suivi. |

### Qui cède le passage

L'ordre par défaut, réglable par projet :

1. une réservation en cours ;
2. le ticket lié à un incident ouvert, puis la priorité du ticket ;
3. l'échéance la plus proche ;
4. le chantier le plus avancé (PR ouverte, puis en cours, puis seulement déclaré) ;
5. le premier arrivé.

À égalité, l'agent cède à l'humain : attendre lui coûte moins. Le réglage peut être inversé.

### Forme de la réponse

```text
verdict : attendre
collision : D4 · ressource exclusive « migrations »
voisin : PROJ-88 · agent de Léa (session 3f2a) · PR ouverte · actif il y a 4 min
raison : une seule migration à la fois
avis du voisin : « je renomme invoices.total en total_cents »
à faire : continuer hors de db/migrations/, puis redéclarer après la fusion de PROJ-88
reprise estimée : 25 min
```

Aucun verdict sans voisin nommé, chemin cité et marche à suivre.

## 9. Les agents, acteurs à part entière

Les agents ne sont pas un simple canal de saisie. Ils sont la raison d'être du produit, et cinq mécanismes leur sont propres.

### 9.1 Trois sortes de collisions d'agents

| Cas | Exemple | Qui est prévenu |
|---|---|---|
| Agents d'un même pilote | Quatre sessions lancées en parallèle par une personne | Ce pilote, une seule fois |
| Agents de pilotes différents | L'agent de Léa et celui de Karim sur la facturation | Les deux pilotes |
| Agent et humain | Un agent entre dans le fichier d'une PR en cours de revue | Le pilote et l'auteur de la PR |

Les sous-agents lancés par un agent forment un quatrième cas : ils partagent un ticket et se gênent entre eux. Chacun reçoit un sous-chantier (lot S).

### 9.2 Le protocole de l'agent

Publié comme skill (`SKILL.md`), réutilisable par n'importe quel agent :

1. Avant d'écrire, appeler `declare-footprint` avec le ticket et les chemins visés.
2. Lire le verdict. « Prudence » : lire le chantier voisin, puis continuer. « Attendre » : travailler hors de la zone, ou demander un autre ticket avec `list-clear-work`.
3. Si le travail déborde de ce qui était annoncé, redéclarer.
4. Avant un renommage, une suppression ou un changement de signature, poster un avis.
5. À la fin, appeler `close-worksite`.

Un agent en attente ne boucle pas. Il change de sujet ou s'arrête en annonçant ce qu'il attend.

### 9.3 Le hook : observer sans compter sur l'agent

Un agent peut oublier le protocole. Le hook de son client ne l'oublie pas : il s'exécute avant chaque modification de fichier et reçoit le chemin.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command",
          "command": "\"$CLAUDE_PROJECT_DIR\"/.chantier/hook.sh open" } ] }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "http",
            "url": "https://<installation>.webtrigger.atlassian.app/<chemin>/touch",
            "timeout": 3,
            "headers": {
              "Authorization": "Bearer $CHANTIER_TOKEN",
              "X-Chantier-Repo": "acme/billing"
            },
            "allowedEnvVars": ["CHANTIER_TOKEN"]
          }
        ]
      }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command",
          "command": "\"$CLAUDE_PROJECT_DIR\"/.chantier/hook.sh close" } ] }
    ]
  }
}
```

Ce fichier est généré par l'app et déposé dans le dépôt ; seul le jeton reste sur le poste de chacun.

| Événement | Rôle |
|---|---|
| `SessionStart` | Le script lit la branche, y trouve la clé du ticket et ouvre le chantier. La réponse injecte dans le contexte de l'agent la liste de ses voisins. |
| `PreToolUse` sur `Edit`, `Write`, `NotebookEdit` | Le chemin entre dans l'emprise observée. S'il y a collision, l'avertissement est renvoyé à l'agent. |
| `SubagentStart` | Ouvre un sous-chantier et injecte les voisins dans le contexte du sous-agent (lot S). |
| `SessionEnd` | Passe le chantier en pause. Si l'appel n'aboutit pas dans la seconde et demie allouée à cet événement, la dormance du § 11 prend le relais. |

Réponse en cas de prudence : le travail continue, l'agent est informé.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Chantier voisin : PROJ-88 (agent de Léa, PR ouverte) modifie aussi src/billing/invoice.ts. Avis : « je renomme total en total_cents ». Lis sa PR avant de modifier ce fichier."
  }
}
```

Réponse en mode dur, zone réservée : la modification est refusée.

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "db/migrations/ est réservé par PROJ-88 jusqu'à 15 h 10. Continue hors de ce dossier, puis redéclare."
  }
}
```

Trois précisions :

- Le hook est ouvert par défaut. Si l'app ne répond pas en trois secondes, l'agent continue. Le produit conseille ; il ne bloque que là où le projet l'a décidé.
- Le hook `WorktreeCreate` n'est pas utilisé : le configurer remplace la création de la copie de travail par git.
- Pour limiter les appels, une variante remplace le hook `http` par un script local qui n'appelle l'app qu'à la première modification de chaque fichier.

### 9.4 Le courrier de chantier

Un avis posté par un chantier arrive chez ses voisins par deux chemins : la réponse de leur prochain appel d'outil, et le contexte ajouté par le hook.

C'est le seul moyen de parler à un agent en plein travail sans interrompre son pilote. Un humain l'utilise aussi : Léa écrit « ne touchez pas à `auth/` avant 15 h » dans le panneau de son ticket, et tous les agents dont l'emprise est proche le lisent à leur modification suivante.

Chaque avis est remis une fois par session. Les avis restent visibles sur le ticket.

### 9.5 Répartir une flotte

`plan-parallel-work` prend une requête JQL et un nombre d'agents. Il rend des vagues.

1. Chaque ticket reçoit son emprise, prédite ou déjà déclarée.
2. Un graphe relie les tickets en collision D2 ou plus, ou qui partagent une ressource exclusive.
3. Les tickets charnières, les plus reliés, passent seuls et en premier.
4. Les autres sont rangés en vagues, par priorité, sans deux tickets reliés dans la même vague et sans dépasser le nombre d'agents.

```text
6 tickets, 3 agents
Vague 1 : PROJ-90, seul (ticket charnière : renomme le service de facturation)
Vague 2 : PROJ-88, PROJ-93, PROJ-95
Vague 3 : PROJ-101 (après PROJ-88 : même dossier de migrations), PROJ-97
À surveiller : PROJ-93 × PROJ-95, même fichier de traductions (point chaud)
Confiance : moyenne, deux tickets n'ont pas de composant
```

Un orchestrateur n'a plus à deviner : il demande le plan, lance la vague, puis redemande.

### 9.6 Identité d'un agent

Un agent est identifié par trois éléments : le compte de son pilote, son client, sa session.

- Par MCP, le compte vient du contexte de l'appel. La session est une entrée fournie par l'agent : elle sert à distinguer, jamais à accorder un droit.
- Par le hook, le compte vient du jeton personnel ; la session et, pour un sous-agent, son identifiant viennent de l'événement.

## 10. Les humains sans agent

Personne n'est obligé d'installer quoi que ce soit.

| Moyen | Ce qu'il apporte |
|---|---|
| Passage du ticket à « En cours » | Ouvre un chantier avec l'emprise prédite |
| Panneau du ticket | Bouton « J'y travaille », zones à cocher, celles de la prédiction déjà cochées |
| Étape de CI fournie | Envoie la liste des fichiers de la branche à chaque push : emprise constatée |
| App compagne Bitbucket (lot S) | Fait la même chose sans toucher à la CI, à partir des événements de push et de PR |
| Fusion de la PR ou clôture du ticket | Ferme le chantier et libère les voisins en attente |

L'étape de CI tient en une commande : la liste des fichiers modifiés depuis le point de divergence avec la branche principale, envoyée au point d'entrée de l'app. Des modèles sont fournis pour Bitbucket Pipelines, GitHub Actions et GitLab CI.

## 11. Vie d'un chantier

| État | Entrée | Effet sur les collisions |
|---|---|---|
| Prévu | Ticket créé ou planifié | Emprise prédite, plafonnée à D1 |
| Ouvert | Déclaration, ou ticket « En cours » | Pleine valeur |
| Actif | Modification observée récente | Pleine valeur, marqué « actif il y a n min » |
| En pause | Fin de session, branche poussée sans PR | Pleine valeur |
| En revue | PR ouverte | Pleine valeur, fusion annoncée comme proche |
| Endormi | Aucune activité depuis 24 h (réglable) | Un cran de moins |
| Fermé | Fusion, abandon, ticket terminé, ou sept jours endormi | Aucun |

Deux garanties :

- **Aucune réservation éternelle.** Durée par défaut de deux heures, 24 heures au plus, prolongée par l'activité observée, libérée à l'expiration.
- **Aucun chantier fantôme.** Un chantier sans activité s'endort puis se ferme seul. Le pilote est prévenu avant.

## 12. Avant le sprint

La détection commence avant que quiconque écrive du code.

- **Vérification du sprint.** Une action sur le sprint ouvre la matrice de ses tickets : paires à risque, tickets charnières, ordre conseillé.
- **Champ « Collisions ».** Nombre de collisions et pire degré, à afficher sur les cartes du tableau (affichage à valider, § 19).
- **Fonction JQL.** `issue in collidingWork()` et `issue in collidesWith("PROJ-88")`.
- **Carte des chantiers.** L'arborescence du dépôt, colorée selon l'occupation : qui est où, depuis quand, avec quel degré de chevauchement.

## 13. Apprendre de ce qui s'est passé

- **Précision de la prédiction.** À chaque fusion, l'emprise prédite est comparée à l'emprise constatée. Le taux est affiché par composant, et la confiance annoncée en dépend.
- **Collisions réelles.** L'étape de CI signale quand un rebase ou une fusion a produit un conflit. L'app sait alors si elle l'avait vu venir.
- **Reclassement des zones.** Un fichier où les chevauchements ne produisent jamais de conflit est proposé comme point chaud. Un dossier où ils en produisent toujours est proposé comme ressource exclusive.
- **Quatre chiffres.** Collisions vues avant la première ligne, pendant le travail, à la PR, et manquées jusqu'à la fusion.

## 14. Exigences fonctionnelles

Priorités : **M** = indispensable pour la soumission, **S** = souhaitable, **C** = après le hackathon.

| N° | Exigence | Priorité |
|---|---|---|
| CC-01 | Ouvrir, mettre à jour, mettre en pause et fermer un chantier (ticket, dépôt, acteur, session) | M |
| CC-02 | Enregistrer une emprise déclarée (fichiers, dossiers, motifs) et rendre un verdict en moins de 2 s | M |
| CC-03 | Détecter les chevauchements entre chantiers d'un même dépôt, degrés D0 à D4 | M |
| CC-04 | Zones nommées avec nature, et catalogue par défaut | M |
| CC-05 | Point d'entrée du hook : emprise observée fichier par fichier, avertissement renvoyé à l'agent | M |
| CC-06 | Distinguer les sessions d'un même pilote et détecter leurs collisions | M |
| CC-07 | Réservation limitée en durée, expiration et libération automatiques | M |
| CC-08 | Avis entre chantiers, remis une fois par les réponses d'outils et par le hook | M |
| CC-09 | Panneau du ticket : emprise par source, voisins, collisions, issues du § 8 | M |
| CC-10 | Outils MCP du § 15 | M |
| CC-11 | `plan-parallel-work` : vagues sans collision à partir d'un JQL | M |
| CC-12 | Emprise prédite d'après le composant et les tickets semblables fusionnés | M |
| CC-13 | Point d'entrée CI : emprise constatée d'une branche | M |
| CC-14 | Carte des chantiers | M |
| CC-15 | Console de simulation, avec le scénario « quatre agents » prêt à rejouer | M |
| CC-16 | Agent Rovo « Chef de chantier » et skill du protocole | M |
| CC-17 | Dormance et fermeture automatiques | M |
| CC-18 | Champ « Collisions » sur les cartes et fonctions JQL | S |
| CC-19 | Vérification du sprint depuis l'action de sprint | S |
| CC-20 | Ordre de passage réglable, issue « séquencer » avec lien entre tickets | S |
| CC-21 | Mode dur : refus par le hook en zone réservée ou gelée | S |
| CC-22 | App compagne Bitbucket pour l'emprise constatée | S |
| CC-23 | Sous-chantiers pour les sous-agents | S |
| CC-24 | Prédiction d'après le texte du ticket, par le modèle de Forge, mise en cache | S |
| CC-25 | Mesure des collisions réelles et proposition de reclassement des zones | S |
| CC-26 | Degré D5 : contrats rompus, à partir des symboles déclarés | C |
| CC-27 | Collisions entre dépôts | C |
| CC-28 | Chantiers hors du code : pages Confluence et tickets modifiés par des agents Rovo | C |

## 15. Outils MCP et agent Rovo

### Outils, exposés par `rovo:mcp`

| Clé | Verbe | Entrées | Retour |
|---|---|---|---|
| `declare-footprint` | CREATE | `issueKey`, `repo`, `paths`, `mode`, `etaMinutes`, `session` | Verdict, collisions, avis en attente |
| `check-zone` | GET | `repo`, `paths`, `issueKey` | Verdict, sans rien déclarer |
| `who-touches` | GET | `repo`, `path` | Chantiers présents, état, dernière activité |
| `get-worksite` | GET | `issueKey` | Emprise par source, voisins, collisions, avis |
| `predict-footprint` | GET | `issueKey` | Zones probables, confiance, tickets de référence |
| `list-collisions` | GET | `jql` | Paires en collision, degré, état |
| `list-clear-work` | GET | `jql`, `session` | Tickets prêts que personne ne gêne |
| `plan-parallel-work` | GET | `jql`, `workers` | Vagues, tickets charnières, paires à surveiller |
| `reserve-zone` | CREATE | `issueKey`, `repo`, `paths`, `minutes`, `reason` | Réservation, ou refus motivé |
| `post-notice` | CREATE | `issueKey`, `paths`, `text` | Voisins destinataires |
| `resolve-collision` | UPDATE | `collisionId`, `choice`, `reason` | Issue enregistrée, suites créées |
| `close-worksite` | UPDATE | `issueKey`, `session`, `outcome` | Voisins libérés |
| `report-conflict` | CREATE | `issueKey`, `repo`, `paths`, `withIssueKey` | Conflit réel enregistré |

Les entrées d'une action sont des valeurs simples : `paths` est une chaîne, un chemin par ligne. `mode` vaut `edit`, `create`, `delete` ou `rename`.

Les outils de planification sont en lecture. Un agent déclenché par une règle d'automatisation peut donc calculer le plan à l'ouverture du sprint ; la règle le publie ensuite en commentaire.

### Agent « Chef de chantier »

Pour les humains, dans Rovo Chat :

- « Qui touche à la facturation en ce moment ? »
- « Puis-je lancer PROJ-101 et PROJ-102 en parallèle ? »
- « Organise le sprint 42 pour quatre agents. »
- « Quelles collisions avons-nous manquées le mois dernier ? »

### Skill « avoid-collisions »

Le protocole du § 9.2, en `SKILL.md`, lié aux outils `declare-footprint`, `check-zone`, `list-clear-work`, `post-notice` et `close-worksite`. La même skill est publiée en source ouverte pour les clients qui lisent des fichiers de skills.

## 16. Écrans

1. **Panneau du ticket « Chantier »** (`jira:issuePanel`). Emprise par source, voisins, collisions avec leurs issues, avis reçus et envoyés, bouton « J'y travaille ».
2. **Carte des chantiers** (`jira:projectPage`). Arborescence colorée, graphe des tickets en collision, vagues proposées.
3. **Vérification du sprint** (`jira:sprintAction`). Matrice des tickets, charnières, ordre conseillé.
4. **Réglages du projet** (`jira:projectSettingsPage`). Dépôts, zones et natures, ordre de passage, durées, mode dur, fichier de hooks et étape de CI à télécharger.
5. **Réglages personnels** (`jira:personalSettingsPage`). Jeton du hook, mes chantiers, mes sessions d'agents.
6. **Console de simulation.** Créer des chantiers fictifs, rejouer un scénario, voir les verdicts.
7. **Gadget de tableau de bord** (`jira:dashboardGadget`). Les quatre chiffres du § 13.

## 17. Architecture Forge

Une app installée sur Jira. Une app compagne côté Bitbucket en lot S.

```yaml
# Esquisse, à valider avec forge lint
modules:
  rovo:mcp:
    - key: chantiers-mcp
      name: Chantiers en collision
      tools: [declare-footprint, check-zone, who-touches, get-worksite,
              predict-footprint, list-collisions, list-clear-work, plan-parallel-work,
              reserve-zone, post-notice, resolve-collision, close-worksite, report-conflict]
  action:                    # une entrée par outil
  rovo:agent:
  rovo:skill:
  webtrigger:
    - key: ingest            # hook (open, touch, close) et CI (emprise constatée, conflit réel)
      function: handleIngest
      urlFormat: v2
      response: { type: dynamic }
  jira:issuePanel:
  jira:projectPage:
  jira:projectSettingsPage:
  jira:personalSettingsPage:
  jira:sprintAction:
  jira:customField:          # « Collisions »
  jira:jqlFunction:          # collidingWork, collidesWith
  jira:dashboardGadget:
  trigger:                   # avi:jira:created:issue, avi:jira:updated:issue
  scheduledTrigger:          # fiveMinute : dormance, expirations ; day : prédictions, apprentissage
  sql:
  llm:                       # prédiction d'après le texte du ticket
```

### Déroulement d'une déclaration

1. L'appel arrive par MCP, par le hook ou par la CI. Le compte vient du contexte ou du jeton, jamais des entrées.
2. Le dépôt est ramené à un identifiant, les chemins à des chemins relatifs à sa racine.
3. L'emprise du chantier est mise à jour, avec la source de chaque entrée.
4. L'app cherche les chantiers non fermés du même dépôt dont une entrée est égale, contient ou est contenue.
5. Le degré est calculé selon la nature de la zone et l'état du voisin. La collision est créée ou mise à jour, une seule par paire de chantiers et par zone.
6. Le verdict part avec les avis en attente. L'événement est journalisé, et le champ du ticket mis à jour.

### Ce que reçoit le point d'entrée du hook

L'événement du client, tel quel. Pour une modification, il contient le chemin, mais aussi le texte remplacé et le nouveau texte. Le point d'entrée ne lit que le chemin, la session et le dossier de travail, et écarte le reste avant tout traitement et tout stockage. Pour les équipes qui ne veulent pas que le contenu quitte le poste, la variante par script local n'envoie que le chemin.

### Jetons personnels

Chaque développeur génère son jeton dans les réglages personnels. Il n'est affiché qu'une fois et l'app n'en garde qu'une empreinte. La CI utilise un jeton de projet, limité à l'envoi d'emprises constatées.

## 18. Modèle de données (Forge SQL)

| Table | Colonnes principales |
|---|---|
| `repo` | id, project_id, provider, slug, default_branch |
| `zone` | id, repo_id, name, patterns, nature, component_id, frozen_from, frozen_to |
| `actor_session` | id, account_id, client, session_ref, agent_ref, parent_session_id, first_seen, last_seen |
| `worksite` | id, issue_id, repo_id, session_id, account_id, branch, state, opened_at, last_activity_at, closed_at, outcome |
| `footprint` | worksite_id, path, kind (fichier, dossier, motif), source, mode, first_at, last_at |
| `collision` | id, repo_id, worksite_a, worksite_b, zone_id, path, degree, phase, state, resolution, resolved_by, reason, detected_at |
| `reservation` | id, worksite_id, repo_id, patterns, hard, reason, expires_at, released_at |
| `notice` | id, worksite_id, paths, text, created_at |
| `notice_delivery` | notice_id, session_id, delivered_at |
| `prediction` | issue_id, repo_id, path, confidence, basis_json, computed_at |
| `real_conflict` | id, repo_id, worksite_a, worksite_b, paths, was_detected, reported_at |
| `priority_rule` | project_id, order_json, agent_yields |
| `hook_token` | account_id, token_hash, scope, created_at, last_used_at |
| `event` | seq, at, kind, worksite_id, payload_json |

La recherche de chevauchement s'appuie sur un index (dépôt, chemin). Pour un fichier, l'app cherche le chemin exact et chacun de ses dossiers parents. Pour un dossier, elle cherche aussi les chemins qui commencent par lui.

## 19. Contraintes vérifiées et points à valider

### Vérifié dans la documentation (10 et 11 novembre 2026)

- **Le graphe ne donne pas les fichiers.** Dans Teamwork Graph, le commit externe porte une empreinte, un message et un auteur ; la PR externe porte un état, des relecteurs et un titre. Aucun des deux n'a de champ sur les fichiers modifiés. L'emprise ne peut donc pas venir du graphe, et le bonus Teamwork Graph n'est pas visé.
- **Le hook reçoit le chemin.** Pour `Edit` et `Write`, l'événement `PreToolUse` contient `tool_input.file_path`, en chemin absolu, ainsi que `session_id` et `cwd`. Dans un sous-agent, il contient aussi `agent_id` et `agent_type`.
- **Le hook peut informer ou refuser.** Il renvoie `additionalContext`, lu par l'agent, ou `permissionDecision: "deny"` avec un motif.
- **Hook de type `http`.** L'événement est envoyé en POST. Une réponse hors 2xx ou une panne de connexion ne bloque pas, sauf option `onFailure: "block"`.
- **`SessionStart`** n'accepte que les types `command` et `mcp_tool`, d'où le script. **`SessionEnd`** reçoit un champ `reason` et dispose de 1,5 s par défaut.
- **`SubagentStart`** reçoit l'identifiant et le type du sous-agent, et peut injecter du contexte dans celui-ci.
- **`WorktreeCreate`** : configurer ce hook remplace la création par git. Il n'est pas utilisé.
- **`rovo:mcp`** : Preview, un module par app, 50 outils au plus, accès externe en OAuth 2.1 après activation par un administrateur.
- **Action Forge** : entrées limitées aux chaînes, entiers, nombres et booléens ; 55 s. Un agent déclenché par automatisation n'appelle que les actions `GET`.
- **Déclencheur planifié** : intervalles `fiveMinute`, `hour`, `day`, `week` ; cinq au plus par app ; 900 s au plus.
- **Modules Jira** présents dans l'index : panneau de ticket, page projet, réglages de projet, réglages personnels (Preview), action de sprint, action de tableau, champ personnalisé, fonction JQL, gadget.
- **Une app Forge installée sur Jira ne peut pas appeler l'API Bitbucket**, d'où l'app compagne.
- **Forge SQL** : 1 Gio par installation en production, 5 s par SELECT, pas de clés étrangères.

### À valider par un prototype la première semaine

| Point | Pourquoi | Solution de repli |
|---|---|---|
| Temps de réponse du web trigger à chaque modification | Le hook s'exécute avant chaque écriture | Script local qui n'appelle qu'à la première modification de chaque fichier |
| Compte transmis à une action lors d'un appel MCP externe | Fonde l'identité du pilote | Jeton personnel exigé aussi par MCP |
| Types de hook acceptés par `SubagentStart` et `SessionEnd` | Je ne l'ai vérifié que pour `SessionStart` et `PreToolUse` | Script de type `command` partout |
| Fichiers modifiés par une commande shell (`sed -i`, générateurs) | Ils échappent au filtre `Edit|Write` ; la réponse de l'outil Bash peut lister des fichiers changés | Emprise constatée par la CI |
| Champ personnalisé affiché sur les cartes du tableau | Rend la collision visible sans ouvrir le ticket | Fonction JQL et filtre rapide ; carte des chantiers |
| Recherche de chevauchement en moins de 2 s, pour 50 chantiers et 500 chemins chacun | Verdict rapide | Comparaison en mémoire, par dépôt, sur les seuls chantiers non fermés |
| Qualité de la prédiction sur un historique réel | Fonde la planification | Correspondance manuelle composant → zone |
| Équivalent des hooks dans les autres clients d'agents | Portée au-delà de Claude Code | Outils MCP et étape de CI, valables partout |

## 20. Exigences non fonctionnelles

- **Rapidité.** Verdict en moins de 2 s par MCP, moins de 1 s par le hook dans 95 % des cas.
- **Ouvert par défaut.** Sans réponse de l'app, le travail continue. Seul le mode dur, activé par le projet pour ses zones réservées ou gelées, peut refuser.
- **Rien d'éternel.** Toute réservation expire ; tout chantier inactif s'endort puis se ferme.
- **Peu de bruit.** Une alerte par collision, pas par fichier. Un avertissement n'est remis qu'une fois par session.
- **Explicabilité.** Chaque verdict cite le voisin, le chemin, le degré et la marche à suivre.
- **Sobriété.** L'app garde des chemins, jamais du contenu de fichier.
- **Équité.** Une réservation est bornée en durée et en étendue. Au-delà d'un seuil, elle devient une demande de gel, validée par un responsable.
- **Langues.** Interface en anglais et en français ; soumission en anglais.

## 21. Cas limites

- Branche sans clé de ticket : le chantier existe, rattaché au pilote et à la branche ; le panneau personnel propose de le relier.
- Agent sans hook qui ne déclare rien : invisible jusqu'au push. Le panneau affiche la couverture réelle de chaque chantier (prédite seule, déclarée, observée, constatée).
- Deux déclarations à la même seconde : chacune voit l'autre et reçoit « prudence ». Il n'y a pas de gagnant silencieux.
- Reformatage de tout le dépôt : au-delà d'un seuil de fichiers, l'app propose un gel annoncé au lieu de créer des centaines de collisions.
- Branche qui intègre la branche principale : l'emprise constatée se calcule depuis le point de divergence, sinon elle enfle à tort.
- Renommage d'un dossier : l'emprise couvre l'ancien et le nouveau chemin, et tous les chantiers présents reçoivent un avis.
- Fichier supprimé par l'un, modifié par l'autre : D3.
- Dépôt à plusieurs paquets : zones par paquet, fichier de verrouillage commun en ressource exclusive.
- Un ticket, deux dépôts : un chantier par dépôt.
- Deux sessions sur le même ticket : collisions calculées entre elles, verdict marqué « même ticket ».
- Prédiction fausse : sans conséquence bloquante, et comptée dans la précision affichée.
- Hook en panne : la session est marquée « non observée » ; rien n'est bloqué.

## 22. Recette

1. A déclare `src/billing/` pour PROJ-88. B déclare `src/billing/invoice.ts` pour PROJ-101 : B reçoit « prudence », D2, avec PROJ-88, son acteur et sa dernière activité. Le panneau de PROJ-88 affiche B.
2. Deux sessions du même pilote sur le même fichier : collision détectée, libellée « vos deux agents », une seule alerte.
3. Deuxième chantier dans `db/migrations/` : « attendre », D4, ressource exclusive citée.
4. Par le hook, une modification non déclarée dans l'emprise d'un autre chantier : le fichier entre dans l'emprise observée et l'avertissement est renvoyé à l'agent.
5. Mode dur activé, modification dans une zone réservée : refus avec le motif et l'heure de libération.
6. Réservation expirée : la déclaration suivante reçoit « libre ».
7. Chantier sans activité au-delà du délai : endormi, degré abaissé d'un cran ; fermé après sept jours.
8. Un avis posté par A est remis à B à son prochain appel, une seule fois.
9. `plan-parallel-work` sur les six tickets d'exemple, trois agents : aucune vague ne contient deux tickets en collision D2 ou plus, ni deux tickets sur la même ressource exclusive.
10. L'étape de CI envoie les fichiers d'une branche : l'emprise constatée apparaît pour un développeur sans outil.
11. Si l'app ne répond pas, le hook laisse passer la modification.
12. La clôture du ticket ferme le chantier ; le voisin en attente reçoit « libre ».
13. La console de simulation rejoue les cas 1 à 3 sans aucun dépôt.
14. Aucune table ne contient de contenu de fichier après une session complète avec le hook `http`.

## 23. Scénario de la vidéo (moins de 5 minutes, en anglais)

| Temps | Contenu |
|---|---|
| 0:00 – 0:35 | Un développeur, quatre agents, quatre copies de travail. Tout est vert. Puis la fusion : deux migrations 0042, un service renommé que les autres appellent encore. « Worktrees isolate files, not intentions. » |
| 0:35 – 1:05 | La carte des chantiers : qui est où, en ce moment |
| 1:05 – 2:05 | En direct : l'agent 2 va modifier `invoice.ts`, le hook lui signale le renommage en cours, il s'adapte. L'agent 3 veut une migration : « attendre », il passe à autre chose. |
| 2:05 – 2:45 | « Plan sprint 42 for four agents » : trois vagues, un ticket charnière en premier |
| 2:45 – 3:15 | Les humains aussi : la PR de Léa arrive par la CI, elle poste un avis, les agents le reçoivent |
| 3:15 – 3:40 | Vérification du sprint avant de s'engager |
| 3:40 – 4:05 | Ce qu'on apprend : collisions vues avant la première ligne, contre conflits découverts à la fusion |
| 4:05 – 4:45 | Architecture : `rovo:mcp`, actions, hook, web trigger, Forge SQL |

## 24. Comment les juges testeront

Le site de démonstration fourni ne comprend pas de dépôt de code. Le premier parcours n'en demande donc aucun.

1. **Dans Jira seul.** Console de simulation avec le scénario « Four agents », carte des chantiers, panneau d'un ticket d'exemple, vérification du sprint, agent Rovo.
2. **Avec un client MCP.** Activer l'exposition externe, connecter le client, appeler `declare-footprint` deux fois avec deux sessions.
3. **Avec le hook.** Cloner le dépôt d'exemple public, qui contient déjà le fichier de hooks ; renseigner le jeton ; lancer deux sessions.
4. **Sans rien installer.** Deux commandes `curl` fournies simulent un push de CI et font apparaître une emprise constatée.

## 25. Plan jusqu'au 22 décembre

| Semaine | Objectif |
|---|---|
| 11 – 17 nov. | Les validations du § 19 ; `declare-footprint` par MCP, `touch` par le hook, chevauchement en SQL |
| 18 – 24 nov. | Zones, natures, degrés, verdicts, réservations, dormance ; console de simulation |
| 25 nov. – 1er déc. | Panneau du ticket, avis, fichier de hooks généré, point d'entrée CI |
| 2 – 8 déc. | Prédiction, `plan-parallel-work`, carte des chantiers |
| 9 – 15 déc. | Agent Rovo, skill, réglages, lot S selon le temps restant ; gel des fonctionnalités le 15 |
| 16 – 22 déc. | Recette, vidéo, instructions pour les juges, soumission, dépôt Marketplace |

## 26. Risques

| Risque | Parade |
|---|---|
| Personne ne déclare | Le hook observe sans coopération, la CI constate, la prédiction couvre le reste |
| Trop d'alertes, donc ignorées | Degrés, points chauds, une alerte par collision, reclassement d'après les faits |
| Verrous oubliés qui bloquent l'équipe | Expiration et dormance obligatoires, aucune réservation sans durée |
| Le hook ralentit l'agent | Délai de trois secondes, ouverture par défaut, variante avec cache local |
| Dépendance à un seul client pour le hook | Outils MCP et étape de CI valables pour tous |
| Prédiction peu fiable | Jamais bloquante, affichée avec sa confiance, mesurée à chaque fusion |
| Du code quitte le poste par le hook | Contenu écarté à l'entrée, variante par script qui n'envoie que le chemin |
| Réserver pour gêner les autres | Bornes de durée et d'étendue, journal, gel validé par un responsable |
| Juges sans dépôt de code | Console de simulation et commandes `curl` |

## 27. La vision poussée à l'extrême

- **De l'alerte au répartiteur.** L'orchestrateur ne demande plus un plan : il demande « le prochain ticket libre pour l'agent 3 ». L'app tient la file, et garantit qu'aucun agent ne reçoit un ticket en collision avec un chantier ouvert.
- **La largeur parallèle, nouvelle mesure d'un code.** « Ce dépôt supporte trois agents à la fois. Découper `routes.ts` en ferait travailler sept. » L'architecture se juge aussi à ce qu'elle permet de mener de front, et la dette se chiffre en agents qui attendent.
- **Découpage avant le sprint.** L'app repère les tickets charnières et propose de les extraire, pour que le reste du sprint devienne indépendant.
- **Collisions de sens.** Un agent qui change une signature prévient ceux qui l'utilisent, même sans fichier commun, et jusque dans les autres dépôts.
- **Négociation entre agents.** Deux agents en collision échangent leurs avis, proposent un ordre, l'app arbitre selon les règles. Les humains ne voient que les désaccords.
- **Tout ce qui se modifie.** Pages Confluence réécrites par deux agents Rovo, configuration Jira, état d'infrastructure, environnement de recette : ce sont des ressources exclusives comme les autres.
- **Un protocole ouvert.** Déclarer son emprise avant d'écrire devient un réflexe commun à tous les agents, quel que soit leur éditeur.

## 28. Liens avec les autres cahiers des charges

- **Brief de contexte (02)** : le brief gagne une section « chantiers voisins », et `list-ready-work` se croise avec `list-clear-work`.
- **Permis d'agir (06)** : même hook, même jeton, même point d'entrée. Une réservation est à l'espace ce qu'un permis est à l'action ; une zone gelée est une interdiction temporaire.
- **Merge avec contexte (03)** : nouvelle règle « collision D3 ou plus non résolue avec une PR ouverte », et app compagne Bitbucket commune.
- **Échecs de CI avec mémoire (04)** : même étape de CI pour signaler les conflits réels.

## 29. Sources

- [Codegeist 2026](https://codegeist2026.devpost.com/) et son [règlement](https://codegeist2026.devpost.com/rules)
- [Hooks de Claude Code](https://code.claude.com/docs/en/hooks)
- [Commit externe, Teamwork Graph](https://developer.atlassian.com/platform/teamwork-graph/api-reference/object-types/ExternalCommit/)
- [Pull request externe, Teamwork Graph](https://developer.atlassian.com/platform/teamwork-graph/api-reference/object-types/ExternalPullRequest/)
- [Module Rovo MCP](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-mcp/)
- [Module Action](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-action/)
- [Module Rovo Agent](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/)
- [Déclencheur planifié](https://developer.atlassian.com/platform/forge/manifest-reference/modules/scheduled-trigger/)
- [Web trigger](https://developer.atlassian.com/platform/forge/manifest-reference/modules/web-trigger/)
- [Modules Jira](https://developer.atlassian.com/platform/forge/manifest-reference/modules/index-jira/)
- [Limites d'invocation](https://developer.atlassian.com/platform/forge/limits-invocation/) et [limites SQL](https://developer.atlassian.com/platform/forge/limits-sql/)
