# ctxjev

[en](https://github.com/x96x64/ctxjev/blob/main/README.md) | [ja](https://github.com/x96x64/ctxjev/blob/main/README.ja.md) | [zh](https://github.com/x96x64/ctxjev/blob/main/README.zh.md) | [es](https://github.com/x96x64/ctxjev/blob/main/README.es.md) | [ko](https://github.com/x96x64/ctxjev/blob/main/README.ko.md) | [pt](https://github.com/x96x64/ctxjev/blob/main/README.pt.md) | [fr](https://github.com/x96x64/ctxjev/blob/main/README.fr.md) | **de**

<!-- translation-source: README.md sha256=a7698a8be4b8ca9f498efbdcbfac02aa00951a43b11dbdd0f4f7bfc8344235bc -->
> Aus der englischen README übersetzt. Bei Abweichungen ist die englische Fassung maßgeblich.

**Bewertet den Verlauf eines KI-Agenten und entscheidet, was behalten, verworfen oder zusammengefasst wird:
standardmäßig offline, auf Wunsch mit [Jev](https://typesafe.ai) von TypeSafe AI.**

[![npm: ctxjev-core](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm: ctxjev-cli](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm: ctxjev-mcp](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-core.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-core.svg)](https://nodejs.org)

- **Standardmäßig verlässt nichts Ihren Rechner** – weder mit der CLI noch mit der Bibliothek, noch mit dem MCP-Server, noch mit dem Claude-Code-Plugin.
  Jev muss ausdrücklich aktiviert werden (`--scorer jev`, `scorer: 'jev'`, `scorer: "jev"`, `CTXJEV_SCORER=jev`) und benötigt `TYPESAFE_API_KEY`.
- **Der Nutzen ist nicht belegt:** Bei zurückgehaltenen (held-out) Aufgaben hat sich für keine Bewertungsmethode
  gezeigt, dass sie einem Agenten hilft, mehr Aufgaben zu erledigen als bei einfachem Abschneiden. Siehe
  [Stand und Grenzen](#stand-und-grenzen).

## In 30 Sekunden ausprobieren

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

Die Standardmethode `recency` ist einfaches Abschneiden: Neuere Einträge erhalten höhere Werte, und das Ziel wird
nicht verwendet. Hier bleibt der sachfremde Aufruf `ls public/audio` erhalten, weil er der neueste Eintrag ist. `--scorer local`
ordnet stattdessen nach der Schlüsselwortübereinstimmung mit dem Ziel, ebenfalls offline:

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

## Funktionen

- **Eingebaute Bewertungsmethoden oder Ihre eigene:** `recency` (einfaches Abschneiden, Standard), `local`
  (Schlüsselwortübereinstimmung) und `jev` (Jevs Urteil über die Relevanz für Ihr Ziel; optional).
- **Kürzen, ohne die Anfrage ungültig zu machen:** `pruneMessages()` entfernt ein `tool_use` zusammen mit seinem
  `tool_result`, rührt die erste Nachricht und den letzten Turn nie an, behält, was der Benutzer geschrieben hat,
  und meldet, was die Änderung einen Prompt-Cache kostet.
- **Ein Claude-Code-Plugin**, das die am höchsten bewerteten Einträge direkt nach der Kompaktierung wieder in den Kontext einbringt.
- **Ein MCP-Server** mit den Tools `score_relevance` und `prune_history` für jeden MCP-Host.
- **Maskierung von Geheimnissen** in gängigen Formaten, bevor irgendetwas an Jev geht (nach dem Best-Effort-Prinzip, nicht lückenlos).
- **Tokenzählung im Code** mit `gpt-tokenizer` (einer Annäherung an den Tokenizer von Claude), nie durch Jev.

## Was brauche ich?

| Sie möchten … | Verwenden Sie | Wird standardmäßig etwas gesendet? |
| --- | --- | --- |
| Sehen, wie ein Transkript bewertet wird, oder ein gespeichertes kürzen | [`ctxjev-cli`](packages/cli) | Nein |
| Veralteten Verlauf in einer selbst geschriebenen Agentenschleife entfernen | [`ctxjev-core`](packages/core) | Nein |
| Wichtige Details über die Kompaktierung von Claude Code hinweg behalten | [das Claude-Code-Plugin](packages/claude-plugin) | Nein |
| Jedem MCP-Host Bewertungstools geben | [`ctxjev-mcp`](packages/mcp-server) | Nein: nur ein Aufruf, der `scorer: "jev"` übergibt |
| ctxjev aus Codex verwenden | `ctxjev-mcp`, über das [Codex-Plugin](#codex) | Wie `ctxjev-mcp` |

## Installation

Alles benötigt Node.js 20 oder neuer.

```bash
npm install -g ctxjev-cli     # the ctxjev command
npm install ctxjev-core       # the library
```

`ctxjev-mcp` muss nicht installiert werden: Ihr MCP-Host führt `npx ctxjev-mcp@0.7.2` aus (siehe [MCP-Server](#mcp-server)).

**Claude-Code-Plugin.** In Claude Code (CLI oder Desktop-App):

```
/plugin marketplace add x96x64/ctxjev
/plugin install ctxjev@ctxjev-plugins
```

Es ist nicht über npm erhältlich. Der Marketplace installiert es aus diesem Repository anhand des Git-Tags des neuesten Releases,
Sie erhalten also nur veröffentlichten Code.

**Jev (optional).** Holen Sie sich einen Schlüssel unter [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys)
und setzen Sie `TYPESAFE_API_KEY` in der Umgebung, in der ctxjev läuft.

## Verwendung

### CLI

`ctxjev analyze` gibt einen Bericht aus; `ctxjev prune` gibt das Transkript ohne die als `drop` markierten
Einträge aus, auf die Standardausgabe oder in die Datei `--out <file>`. Es liest das eigene JSON-Format von ctxjev, eine
Anthropic-Messages-Konversation oder eine `.jsonl`-Sitzung von Claude Code (nur analyze) und erkennt selbst, welches.

```console
$ ctxjev prune checkout-bug.json --out pruned.json
removed 2 of 7 entries, ~27 tokens · scored by position alone
⚠ removed the first entry (e1): this transcript has no user entry to protect as the original request
```

Standardmäßig entfernt `prune` im eigenen Format von ctxjev nie den ersten Benutzereintrag oder die letzten 2 Einträge
und rührt in einer Anthropic-Messages-Konversation nie die erste Nachricht oder den letzten Turn an. Alle Optionen
stehen in der [README von `ctxjev-cli`](packages/cli/README.md).

### Bibliothek

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

Jede andere Form von Verlauf funktioniert über `pruneContext(entries, goal)`: Die Funktion nimmt einfache Einträge
`{ id, role, toolName?, content, timestamp }` entgegen und liefert eine Entscheidung pro Eintrag. Die vollständige
API steht in der [README von `ctxjev-core`](packages/core/README.md).

### MCP-Server

`ctxjev-mcp` ist ein stdio-MCP-Server mit den Tools `score_relevance` (ein Wert pro Eintrag) und
`prune_history` (eine keep/drop/summarize-Entscheidung pro Eintrag sowie ein Einsparungsbericht).

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2   # Claude Code
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2    # Codex
```

Die Tools bewerten offline (`local`), sofern ein Aufruf nicht `scorer: "jev"` übergibt; lassen Sie `--env TYPESAFE_API_KEY=...` weg, wenn Sie Jev nie verwenden möchten. Ein MCP-Tool kann nichts aus dem
Kontext seines eigenen Hosts entfernen, und der Agent zahlt Ausgabe-Tokens, um seinen Verlauf als Argumente zu
senden; ein Aufruf spart also für sich genommen keine Tokens. Gedacht ist er für Agenten-Frameworks, die die Werte
selbst umsetzen. Die Einrichtung für andere Hosts steht in der [README von `ctxjev-mcp`](packages/mcp-server/README.md).

### Claude-Code-Plugin

Die Hooks von Claude Code können das Transkript lesen, aber nicht umschreiben; das Plugin arbeitet daher neben der
eigenen Kompaktierung von Claude Code:

```
PreCompact             → score the entries since the last compaction; cache the top few
  (Claude Code's own compaction runs, untouched)
SessionStart (compact) → print that cache as a short digest; Claude Code adds it to context
```

Es bewertet anhand Ihrer ersten Anfrage sowie Ihrer neuesten Anweisung oder anhand eines Ziels, das Sie mit
`/ctxjev:set-goal <text>` festlegen (für diese Sitzung, über Kompaktierungen hinweg). `/ctxjev:status` zeigt das
Ziel, was der letzte Lauf getan hat und warum, und was behalten wurde. Mehr in der
[README des Plugins](packages/claude-plugin/README.md).

### Codex

Codex nutzt ctxjev über `ctxjev-mcp` als MCP-Tools. Führen Sie entweder die Zeile `codex mcp add` oben aus, oder
installieren Sie das Plugin-Paket aus diesem Repository: Es registriert denselben Server und weist Codex an, Ihren
`TYPESAFE_API_KEY` an ihn weiterzugeben (`env_vars`):

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

Mehr bekommt Codex nicht: Für Codex gibt es kein Gegenstück zu den Kompaktierungs-Hooks des Claude-Code-Plugins,
und ctxjev liest die eigenen Sitzungsprotokolle von Codex nicht.

## Konfiguration

| Methode | Ordnet nach | Nutzt das Ziel | Sendet etwas | Standard in |
| --- | --- | --- | --- | --- |
| `recency` | Position: ältester 0, neuester 1 (einfaches Abschneiden) | Nein | Nein | CLI, Bibliothek |
| `local` | Schlüsselwortübereinstimmung mit dem Ziel, innerhalb des Stapels in eine Rangfolge gebracht | Ja | Nein | Claude-Code-Plugin, MCP-Tools |
| `jev` | Jevs Ja/Nein-Urteil über die Relevanz für das Ziel | Ja | Maskierte Auszüge und das Ziel, an TypeSafe AI | Nirgends: optional |

`local` und `jev` verrechnen ihre Relevanz mit der Position jedes Eintrags: `recencyWeight` (Standard `0.1`) gibt an,
wie stark die Position zählt. Ein Eintrag mit einem Wert unter `dropBelow` (Standard `0.3`) wird als `drop`
markiert, unter `summarizeBelow` (Standard `0.6`) als `summarize`, alles andere als `keep`.

| Umgebungsvariable | Verwendet von | Wirkung |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | allem, was Jev aufruft | Ihr Jev-Schlüssel. Ein Wert, der nur ein nicht aufgelöster Platzhalter ist, etwa `${TYPESAFE_API_KEY}`, gilt als nicht gesetzter Schlüssel. |
| `CTXJEV_SCORER` | Claude-Code-Plugin | `jev`, um Jev zu aktivieren; bei jedem anderen Wert (oder ohne Wert) wird offline bewertet. |
| `CTXJEV_PRESERVE_LIMIT` | Claude-Code-Plugin | Wie viele Einträge über eine Kompaktierung hinweg mitgenommen werden, 1 bis 50 (Standard 5). |
| `CTXJEV_STATE_DIR` | Claude-Code-Plugin | Wo es seinen Zustand speichert (Standard `~/.claude/ctxjev`). |

## Funktionsweise

- **Eine Anfrage pro Stapel.** Mit Jev wird jeder Eintrag zu einer Ja/Nein-Frage, und bis zu 50 werden auf einmal
  auf Grundlage eines gemeinsamen Zustands gestellt. Jeder Stapel sieht auch die neueste Aktivität; ein alter
  fehlgeschlagener Test wird also in dem Wissen beurteilt, dass ein späterer Lauf ihn behoben hat.
- **Aktualität ist relativ zum Stapel**, nicht zur Uhrzeit; ein gespeichertes Transkript erhält dieselben Werte wie eine laufende Sitzung.
- **Jev muss nie zählen oder schreiben.** Tokenzahlen kommen von einem Tokenizer, und die
  keep/drop/summarize-Entscheidung ist ein einfacher Schwellenwertvergleich mit Jevs Wert.
- **Bei den Einsparungen zählt, was tatsächlich entfernt wird**, mit der vollen Größe jedes Eintrags, nicht die Größe des bewerteten Auszugs.

Die Begründung jeder Entscheidung steht in [docs/design-notes.md](docs/design-notes.md).

## Datenschutz

- Mit `recency` oder `local` wird nirgendwohin etwas gesendet.
- Mit `jev` werden das Ziel und ein kurzer Auszug jedes Eintrags (keine ganzen Dateien und keine vollständige
  Tool-Ausgabe) an die Jev-API von TypeSafe AI gesendet. Geheimnisse in gängigen Formaten werden vorher durch
  `[REDACTED]` ersetzt, und Eintrags-IDs werden gar nicht gesendet. Die Maskierung beruht auf Mustererkennung: Sie
  verringert das Risiko, kann aber nicht jedes Geheimnis erkennen. Wenden Sie `--scorer jev` daher nicht auf ein
  sensibles Protokoll an, ohne es vorher zu prüfen.
- Das Claude-Code-Plugin speichert seinen Zustand in `~/.claude/ctxjev/`, nur für Sie lesbar und nie in Ihrem
  Projekt. Der Bewertungscache der CLI ist `~/.cache/ctxjev/score-cache.json` und enthält Hashes, keinen Transkripttext.

Wie gut die Maskierung funktioniert, gemessen an Zeilen, die ohne Kenntnis ihres Codes geschrieben wurden, steht in
[docs/evaluation.md](docs/evaluation.md#secret-masking-measured-blind). Ein Leck melden Sie wie in
[SECURITY.md](SECURITY.md) beschrieben.

## Stand und Grenzen

ctxjev tut, was diese Seite beschreibt, aber ob das einem Agenten hilft, seine Arbeit zu erledigen, ist nicht belegt.
In einem [präregistrierten Vergleich](docs/evaluation.md) mit <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> Aufgaben, die beim Entwurf
nie verwendet wurden, erledigte ein Agent, der den nach Jevs Rangfolge gekürzten Verlauf erhielt, denselben Anteil
der Aufgaben wie ein Agent mit einfach abgeschnittenem Verlauf (Unterschied in Prozentpunkten, mit seinem
95%-Konfidenzintervall: <!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku --> mit Claude Haiku 4.5, <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet --> mit Claude Sonnet 5).
Nach dem präregistrierten Maß dafür, was jede Aufgabe brauchte, behielt Jevs Rangfolge bei knappem Budget
<!-- generated:holdout-retention-jev -->23.6%<!-- /generated:holdout-retention-jev -->, weniger als eine zufällige Anordnung derselben Einträge (<!-- generated:holdout-retention-random -->26.5%<!-- /generated:holdout-retention-random -->).
Auch der Digest des Claude-Code-Plugins hat keine nachgewiesene Wirkung. Deshalb bewerten alle Einstiegspunkte standardmäßig offline. Die Aufgaben sind klein, und die zurückgehaltene Aufgabenmenge ist nun aufgebraucht;
[docs/evaluation.md](docs/evaluation.md) enthält alle Zahlen, wie sie entstanden sind und was sie nicht zeigen können.

## Dokumentation

- [docs/evaluation.md](docs/evaluation.md): was gemessen wurde und was nicht
- [docs/design-notes.md](docs/design-notes.md): warum es so funktioniert, wie es funktioniert
- [docs/api-stability.md](docs/api-stability.md): was in 1.x stabil bleibt
- [docs/known-limitations.md](docs/known-limitations.md): was es nicht kann, und warum
- READMEs der Pakete: [`ctxjev-core`](packages/core/README.md), [`ctxjev-cli`](packages/cli/README.md),
  [`ctxjev-mcp`](packages/mcp-server/README.md), [Claude-Code-Plugin](packages/claude-plugin/README.md)
- [CHANGELOG.md](CHANGELOG.md) und [ROADMAP.md](ROADMAP.md)

## Mitwirken

Issues und Pull Requests sind willkommen. [CONTRIBUTING.md](CONTRIBUTING.md) beschreibt die Einrichtung, die Regeln,
denen jede Änderung folgt, und wie Releases entstehen; [AGENTS.md](AGENTS.md) enthält dieselben Regeln vollständig,
für KI-Coding-Agenten ebenso wie für Menschen.

```bash
pnpm install && pnpm build && pnpm test
```

## Sicherheit

Melden Sie Schwachstellen bitte vertraulich, wie in [SECURITY.md](SECURITY.md) beschrieben, nicht in einem öffentlichen Issue.

## Lizenz

[MIT](LICENSE). ctxjev ist ein unabhängiges Projekt, steht in keiner Verbindung zu TypeSafe AI oder Anthropic und wird
von diesen weder unterstützt noch empfohlen. Es baut auf [`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) und Anthropics
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) auf; alle direkten
Abhängigkeiten stehen unter MIT oder ISC. Einige ihrer eigenen Abhängigkeiten stehen unter BSD-Lizenz (`fast-uri`,
`qs`, `json-schema-typed`) und verlangen ebenfalls, dass ihre Hinweise erhalten bleiben; `pnpm licenses list --prod`
listet sie alle auf. Das Claude-Code-Plugin bündelt Code aus `@typesafe-ai/sdk` und liefert dessen Hinweis in
[`THIRD_PARTY_NOTICES`](packages/claude-plugin/THIRD_PARTY_NOTICES) mit.
