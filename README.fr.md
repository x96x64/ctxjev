# ctxjev

[en](https://github.com/x96x64/ctxjev/blob/main/README.md) | [ja](https://github.com/x96x64/ctxjev/blob/main/README.ja.md) | [zh](https://github.com/x96x64/ctxjev/blob/main/README.zh.md) | [es](https://github.com/x96x64/ctxjev/blob/main/README.es.md) | [ko](https://github.com/x96x64/ctxjev/blob/main/README.ko.md) | [pt](https://github.com/x96x64/ctxjev/blob/main/README.pt.md) | **fr** | [de](https://github.com/x96x64/ctxjev/blob/main/README.de.md)

<!-- translation-source: README.md sha256=04b2c884329cd3020edab16406a515b2aa4981a636c0fcbb0254b636d28d8ee0 -->
> Traduit du README anglais. En cas de divergence, c'est la version anglaise qui fait foi.

**Attribue un score à l'historique d'un agent d'IA et décide quoi garder, retirer ou résumer : hors ligne par
défaut, ou avec [Jev](https://typesafe.ai) de TypeSafe AI si vous l'activez.**

[![npm: ctxjev-core](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm: ctxjev-cli](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm: ctxjev-mcp](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-core.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-core.svg)](https://nodejs.org)

- **Par défaut, rien ne quitte votre machine** avec la CLI, la bibliothèque ou le plugin Claude Code.
  Jev est facultatif (`--scorer jev`, `scorer: 'jev'`, `CTXJEV_SCORER=jev`) et nécessite `TYPESAFE_API_KEY`.
- **Le serveur MCP fait exception :** ses outils utilisent Jev, sauf si l'appel passe `scorer: "local"` ou
  `"recency"`.
- **Son intérêt n'est pas démontré :** sur des tâches mises de côté (held-out), aucune méthode de score n'a montré
  qu'elle aidait un agent à terminer plus de tâches qu'une simple troncature. Voir [État et limites](#état-et-limites).

## Essayez en 30 secondes

```bash
npm install -g ctxjev-cli
curl -O https://raw.githubusercontent.com/x96x64/ctxjev/main/examples/sample-transcripts/checkout-bug.json
ctxjev analyze checkout-bug.json
```

```console
$ ctxjev analyze checkout-bug.json
score: 0–1, position in the transcript (oldest 0, newest 1), not relevance: the goal isn't used · keep = leave as-is, summarize = worth shortening, drop = worth removing

  e1  bash       drop       score 0.00  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       drop       score 0.17  read package.json — saw the dependency list and script names
  e3  grep       summarize  score 0.33  grep "charge" in src/payments.ts — found chargeCustomer() c…
  e4  bash       summarize  score 0.50  ran: git log --oneline -5 — recent commits about unrelated …
  e5  read       keep       score 0.67  read src/payments.ts — the retry handler re-calls chargeCus…
  e6  assistant  keep       score 0.83  Found it: the retry path doesn't check for an in-flight or …
  e7  bash       keep       score 1.00  ran: ls public/audio — unrelated, was checking something el…

3 keep, 2 summarize, 2 drop (of 7 entries)
prune would remove the 2 entries marked drop, ~27 / 154 tokens (18%); the 2 entries marked summarize (~45 tokens) stay as they are unless you shorten them yourself
⚠ would remove the first entry (e1): this transcript has no user entry to protect as the original request
Scored by position alone (newest kept, like plain truncation) — no Jev call, nothing sent.
```

La méthode de score par défaut, `recency`, est une simple troncature : les entrées les plus récentes ont le score le
plus élevé, et l'objectif n'est pas utilisé. Ici, elle garde le `ls public/audio`, sans rapport, simplement parce
qu'il est le plus récent. `--scorer local` classe plutôt par recoupement de mots-clés avec l'objectif, lui aussi hors ligne :

```console
$ ctxjev analyze checkout-bug.json --scorer local
score: 0–1, how much an entry shares your goal's words, ranked within this transcript, blended with recency · keep = leave as-is, summarize = worth shortening, drop = worth removing

  e1  bash       summarize  score 0.45  ran: npm test -- checkout.test.ts — 12 passed, 0 failed
  e2  read       drop       score 0.17  read package.json — saw the dependency list and script names
  e3  grep       keep       score 0.71  grep "charge" in src/payments.ts — found chargeCustomer() c…
  e4  bash       drop       score 0.20  ran: git log --oneline -5 — recent commits about unrelated …
  e5  read       keep       score 0.74  read src/payments.ts — the retry handler re-calls chargeCus…
  e6  assistant  keep       score 0.98  Found it: the retry path doesn't check for an in-flight or …
  e7  bash       drop       score 0.25  ran: ls public/audio — unrelated, was checking something el…

3 keep, 1 summarize, 3 drop (of 7 entries)
prune would remove 2 of the 3 entries marked drop, ~28 / 154 tokens (18%); the 1 entry marked summarize (~16 tokens) stays as it is unless you shorten it yourself
1 marked drop but kept: 1 protected in the last 2 entries
Scored offline by keyword overlap — no Jev call, nothing sent. It matches words only (no synonyms), so treat the decisions as a rough guide.
```

## Fonctionnalités

- **Des méthodes de score intégrées, ou la vôtre :** `recency` (simple troncature, par défaut), `local`
  (recoupement de mots-clés) et `jev` (le jugement de Jev sur la pertinence pour votre objectif ; facultatif).
- **Un élagage qui garde la requête valide :** `pruneMessages()` retire un `tool_use` avec son `tool_result`,
  ne touche jamais au premier message ni au dernier tour, garde ce que l'utilisateur a écrit, et indique ce que la
  modification coûte à un cache de prompts.
- **Un plugin Claude Code** qui réinjecte les entrées les mieux notées juste après la compaction.
- **Un serveur MCP** avec les outils `score_relevance` et `prune_history`, pour n'importe quel hôte MCP.
- **Un masquage des secrets** aux formats courants avant tout envoi à Jev (au mieux, sans être exhaustif).
- **Un décompte des tokens calculé dans le code** avec `gpt-tokenizer` (une approximation du tokenizer de Claude),
  jamais demandé à Jev.

## Lequel me faut-il ?

| Vous voulez… | Utilisez | Envoie-t-il quelque chose par défaut ? |
| --- | --- | --- |
| Voir comment une transcription est notée, ou élaguer une transcription enregistrée | [`ctxjev-cli`](packages/cli) | Non |
| Retirer l'historique périmé dans une boucle d'agent que vous écrivez | [`ctxjev-core`](packages/core) | Non |
| Conserver les détails importants malgré la compaction de Claude Code | [le plugin Claude Code](packages/claude-plugin) | Non |
| Donner des outils de score à n'importe quel hôte MCP | [`ctxjev-mcp`](packages/mcp-server) | Avec une clé définie, des extraits masqués à Jev, sauf si l'appel choisit `local` ou `recency` |
| Utiliser ctxjev depuis Codex | `ctxjev-mcp`, via le [plugin Codex](#codex) | Comme `ctxjev-mcp` |

## Installation

Tout nécessite Node.js 20 ou une version ultérieure.

```bash
npm install -g ctxjev-cli     # the ctxjev command
npm install ctxjev-core       # the library
```

`ctxjev-mcp` ne demande aucune installation : votre hôte MCP exécute `npx ctxjev-mcp@0.7.2` (voir [Serveur MCP](#serveur-mcp)).

**Plugin Claude Code.** Dans Claude Code (CLI ou application de bureau) :

```
/plugin marketplace add x96x64/ctxjev
/plugin install ctxjev@ctxjev-plugins
```

Il n'est pas sur npm. La marketplace l'installe depuis ce dépôt, au tag de la dernière version publiée : vous
ne recevez donc que du code publié.

**Jev (facultatif).** Obtenez une clé sur [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys)
et définissez `TYPESAFE_API_KEY` dans l'environnement où ctxjev s'exécute.

## Utilisation

### CLI

`ctxjev analyze` affiche un rapport ; `ctxjev prune` écrit la transcription sans les entrées marquées `drop`,
sur la sortie standard ou dans `--out <file>`. Il lit le format JSON propre à ctxjev, une conversation Anthropic
Messages ou un `.jsonl` de session Claude Code (analyze seulement), et détecte de quel format il s'agit.

```console
$ ctxjev prune checkout-bug.json --out pruned.json
removed 2 of 7 entries, ~27 tokens · scored by position alone
⚠ removed the first entry (e1): this transcript has no user entry to protect as the original request
```

Par défaut, `prune` ne retire jamais la première entrée de l'utilisateur ni les 2 dernières entrées du format
propre à ctxjev, et ne touche jamais au premier message ni au dernier tour d'une conversation Anthropic Messages.
Toutes les options figurent dans le [README de `ctxjev-cli`](packages/cli/README.md).

### Bibliothèque

```ts
import { pruneMessages } from 'ctxjev-core'

// `messages` is the Anthropic Messages conversation your agent loop sends each turn.
const { messages: pruned, removed } = await pruneMessages(
  messages,
  'Fix a bug where checkout charges customers twice on a slow network retry.',
)
// `pruned` is still a valid request. If your loop's only instruction is the first message, pass
// `protectLastTurn: false`, or that whole loop is the latest turn and nothing is removed.
```

Tout autre format d'historique passe par `pruneContext(entries, goal)`, qui prend de simples entrées
`{ id, role, toolName?, content, timestamp }` et renvoie une décision par entrée. L'API complète est dans le
[README de `ctxjev-core`](packages/core/README.md).

### Serveur MCP

`ctxjev-mcp` est un serveur MCP en stdio dont les outils sont `score_relevance` (un score par entrée) et
`prune_history` (une décision keep/drop/summarize par entrée, plus un rapport d'économies).

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2   # Claude Code
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2    # Codex
```

Omettez `--env TYPESAFE_API_KEY=...` pour l'utiliser uniquement hors ligne. Un outil MCP ne peut rien retirer du
contexte de son propre hôte, et l'agent paie des tokens de sortie pour envoyer son historique en arguments : l'appeler
n'économise donc pas de tokens à lui seul. Il s'adresse aux frameworks d'agents qui agissent d'après les scores. La
configuration des autres hôtes est dans le [README de `ctxjev-mcp`](packages/mcp-server/README.md).

### Plugin Claude Code

Les hooks de Claude Code peuvent lire la transcription mais pas la réécrire ; le plugin fonctionne donc à côté de la
compaction propre à Claude Code :

```
PreCompact             → score the entries since the last compaction; cache the top few
  (Claude Code's own compaction runs, untouched)
SessionStart (compact) → print that cache as a short digest; Claude Code adds it to context
```

Il note par rapport à votre première demande et à votre dernière instruction, ou par rapport à un objectif fixé avec
`/ctxjev:set-goal <text>` (pour cette session, d'une compaction à l'autre). `/ctxjev:status` affiche l'objectif, ce
qu'a fait la dernière exécution et pourquoi, et ce qui a été gardé. Plus de détails dans le
[README du plugin](packages/claude-plugin/README.md).

### Codex

Codex utilise ctxjev via `ctxjev-mcp`, sous forme d'outils MCP. Lancez la ligne `codex mcp add` ci-dessus, ou
installez le paquet de plugin de ce dépôt, qui enregistre le même serveur et indique à Codex de lui transmettre
votre `TYPESAFE_API_KEY` (`env_vars`) :

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

C'est tout ce que Codex obtient : il n'existe pas pour Codex d'équivalent des hooks de compaction du plugin
Claude Code, et ctxjev ne lit pas les journaux de session propres à Codex.

## Configuration

| Méthode | Classe selon | Utilise l'objectif | Envoie quelque chose | Par défaut dans |
| --- | --- | --- | --- | --- |
| `recency` | La position : la plus ancienne 0, la plus récente 1 (simple troncature) | Non | Non | CLI, bibliothèque |
| `local` | Le recoupement de mots-clés avec l'objectif, classé au sein du lot | Oui | Non | Plugin Claude Code |
| `jev` | Le jugement oui/non de Jev sur la pertinence pour l'objectif | Oui | Des extraits masqués et l'objectif, à TypeSafe AI | Outils MCP |

`local` et `jev` combinent leur pertinence avec la position de chaque entrée : `recencyWeight` (par défaut `0.1`)
indique le poids de la position. Une entrée dont le score est inférieur à `dropBelow` (par défaut `0.3`) est marquée
`drop`, inférieur à `summarizeBelow` (par défaut `0.6`) `summarize`, et toute autre `keep`.

| Variable d'environnement | Utilisée par | Rôle |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | tout ce qui appelle Jev | Votre clé Jev. Une valeur qui n'est qu'un espace réservé non développé, comme `${TYPESAFE_API_KEY}`, compte comme une absence de clé. |
| `CTXJEV_SCORER` | Plugin Claude Code | `jev` pour activer Jev ; toute autre valeur note hors ligne. |
| `CTXJEV_PRESERVE_LIMIT` | Plugin Claude Code | Le nombre d'entrées à conserver lors d'une compaction, de 1 à 50 (par défaut 5). |
| `CTXJEV_STATE_DIR` | Plugin Claude Code | L'emplacement de son état (par défaut `~/.claude/ctxjev`). |

## Fonctionnement

- **Une requête par lot.** Avec Jev, chaque entrée devient une question oui/non, et jusqu'à 50 sont posées en une
  fois face à un même état partagé. Chaque lot voit aussi l'activité la plus récente : un ancien test en échec est
  donc jugé en sachant qu'une exécution ultérieure l'a corrigé.
- **La récence est relative au lot**, pas à l'horloge : une transcription enregistrée obtient le même score
  qu'une transcription en cours.
- **Jev n'est jamais chargé de compter ni d'écrire.** Les décomptes de tokens viennent d'un tokenizer, et la
  décision keep/drop/summarize est un simple seuil appliqué au score de Jev.
- **Les économies comptent ce qui est réellement retiré**, à la taille complète de chaque entrée, et non à celle de l'extrait noté.

Le raisonnement derrière chaque choix se trouve dans [docs/design-notes.md](docs/design-notes.md).

## Confidentialité

- Avec `recency` ou `local`, rien n'est envoyé nulle part.
- Avec `jev`, l'objectif et un court extrait de chaque entrée (pas des fichiers entiers ni la sortie complète des
  outils) sont envoyés à l'API Jev de TypeSafe AI. Les secrets aux formats courants sont d'abord remplacés par
  `[REDACTED]`, et les identifiants des entrées ne sont pas envoyés du tout. Le masquage repose sur une
  correspondance de motifs : il réduit l'exposition mais ne peut pas reconnaître tous les secrets ; n'utilisez donc
  pas `--scorer jev` sur un journal sensible sans l'avoir vérifié.
- Le plugin Claude Code garde son état dans `~/.claude/ctxjev/`, lisible par vous seul, jamais dans votre projet.
  Le cache de scores de la CLI est `~/.cache/ctxjev/score-cache.json` et contient des empreintes (hashes), pas le
  texte des transcriptions.

L'efficacité du masquage, mesurée sur des lignes écrites sans voir son code, est indiquée dans
[docs/evaluation.md](docs/evaluation.md#secret-masking-measured-blind). Pour signaler une fuite, voir
[SECURITY.md](SECURITY.md).

## État et limites

ctxjev fait ce que décrit cette page, mais il n'a pas été démontré que cela aide un agent à terminer son travail.
Dans une [comparaison préenregistrée](docs/evaluation.md) sur <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> tâches que la conception
n'avait jamais vues, un agent recevant l'historique élagué selon le classement de Jev a terminé la même proportion de
tâches qu'un agent recevant une simple troncature (différence en points de pourcentage, avec son intervalle de
confiance à 95 % : <!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku --> avec Claude Haiku 4.5, <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet --> avec Claude Sonnet 5).
Selon la mesure préenregistrée de ce dont chaque tâche avait besoin, le classement de Jev en a gardé
<!-- generated:holdout-retention-jev -->23.6%<!-- /generated:holdout-retention-jev --> avec un budget serré, moins qu'un ordre aléatoire des mêmes entrées
(<!-- generated:holdout-retention-random -->26.5%<!-- /generated:holdout-retention-random -->). Le résumé (digest) du plugin Claude Code n'a pas non plus d'effet démontré. C'est
pourquoi tout, sauf les outils MCP, note hors ligne par défaut. Les tâches sont petites, et l'ensemble mis de côté est
désormais épuisé ; [docs/evaluation.md](docs/evaluation.md) donne tous les chiffres, la façon dont ils ont été obtenus
et ce qu'ils ne peuvent pas montrer.

## Documentation

- [docs/evaluation.md](docs/evaluation.md) : ce qui a été mesuré, et ce qui ne l'a pas été
- [docs/design-notes.md](docs/design-notes.md) : pourquoi cela fonctionne ainsi
- README des paquets : [`ctxjev-core`](packages/core/README.md), [`ctxjev-cli`](packages/cli/README.md),
  [`ctxjev-mcp`](packages/mcp-server/README.md), [plugin Claude Code](packages/claude-plugin/README.md)
- [CHANGELOG.md](CHANGELOG.md) et [ROADMAP.md](ROADMAP.md)

## Contribuer

Les issues et les pull requests sont les bienvenues. [CONTRIBUTING.md](CONTRIBUTING.md) explique la mise en place,
les règles que suit chaque modification et la façon dont les versions sont publiées ; [AGENTS.md](AGENTS.md)
contient les mêmes règles en entier, pour les agents de programmation IA comme pour les personnes.

```bash
pnpm install && pnpm build && pnpm test
```

## Sécurité

Signalez toute vulnérabilité en privé, comme l'explique [SECURITY.md](SECURITY.md), et non dans une issue publique.

## Licence

[MIT](LICENSE). ctxjev est un projet indépendant, sans lien avec TypeSafe AI ni Anthropic et sans leur aval. Il
repose sur [`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) et sur le
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) d'Anthropic ; toutes les
dépendances directes sont sous MIT ou ISC. Quelques-unes de leurs propres dépendances sont sous licence BSD
(`fast-uri`, `qs`, `json-schema-typed`) et demandent que vous conserviez également leurs mentions ;
`pnpm licenses list --prod` les liste toutes. Le plugin Claude Code embarque du code de `@typesafe-ai/sdk` et inclut
sa mention dans [`THIRD_PARTY_NOTICES`](packages/claude-plugin/THIRD_PARTY_NOTICES).
