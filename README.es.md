# ctxjev

[en](https://github.com/x96x64/ctxjev/blob/main/README.md) | [ja](https://github.com/x96x64/ctxjev/blob/main/README.ja.md) | [zh](https://github.com/x96x64/ctxjev/blob/main/README.zh.md) | **es** | [ko](https://github.com/x96x64/ctxjev/blob/main/README.ko.md) | [pt](https://github.com/x96x64/ctxjev/blob/main/README.pt.md) | [fr](https://github.com/x96x64/ctxjev/blob/main/README.fr.md) | [de](https://github.com/x96x64/ctxjev/blob/main/README.de.md)

<!-- translation-source: README.md sha256=04b2c884329cd3020edab16406a515b2aa4981a636c0fcbb0254b636d28d8ee0 -->
> Traducido del README en inglés. Si hay alguna diferencia, prevalece la versión en inglés.

**Puntúa el historial de un agente de IA y decide qué conservar, descartar o resumir: sin conexión por
defecto, o con [Jev](https://typesafe.ai) de TypeSafe AI si lo activas.**

[![npm: ctxjev-core](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm: ctxjev-cli](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm: ctxjev-mcp](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-core.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-core.svg)](https://nodejs.org)

- **Por defecto, nada sale de tu máquina** con la CLI, la biblioteca o el plugin de Claude Code.
  Jev es opcional (`--scorer jev`, `scorer: 'jev'`, `CTXJEV_SCORER=jev`) y necesita `TYPESAFE_API_KEY`.
- **El servidor MCP es la excepción:** sus herramientas usan Jev salvo que la llamada pase `scorer: "local"` o
  `"recency"`.
- **Su beneficio no está demostrado:** en tareas reservadas (held-out), no se ha demostrado que ningún método de puntuación
  ayude a un agente a terminar más tareas que el truncamiento simple. Consulta [Estado y límites](#estado-y-límites).

## Pruébalo en 30 segundos

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

El método de puntuación por defecto, `recency`, es el truncamiento simple: las entradas más nuevas puntúan más y no
se usa el objetivo. Aquí conserva el `ls public/audio`, que no tiene nada que ver, solo porque es la entrada más reciente.
`--scorer local` ordena en cambio por coincidencia de palabras clave con el objetivo, también sin conexión:

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

## Características

- **Métodos de puntuación integrados, o el tuyo propio:** `recency` (truncamiento simple, el predeterminado), `local`
  (coincidencia de palabras clave) y `jev` (el juicio de Jev sobre la relevancia para tu objetivo; opcional).
- **Recortes que mantienen la solicitud válida:** `pruneMessages()` elimina un `tool_use` junto con su
  `tool_result`, nunca toca el primer mensaje ni el último turno, conserva lo que escribió el usuario e informa
  de lo que el cambio le cuesta a una caché de prompts.
- **Un plugin para Claude Code** que devuelve las entradas mejor puntuadas justo después de la compactación.
- **Un servidor MCP** con las herramientas `score_relevance` y `prune_history` para cualquier host MCP.
- **Enmascaramiento de secretos** en formatos comunes antes de enviar nada a Jev (en la medida de lo posible, no exhaustivo).
- **Recuento de tokens calculado en código** con `gpt-tokenizer` (una aproximación del tokenizador de Claude),
  nunca pedido a Jev.

## ¿Cuál necesito?

| Quieres… | Usa | ¿Envía algo por defecto? |
| --- | --- | --- |
| Ver cómo puntúa una transcripción, o recortar una guardada | [`ctxjev-cli`](packages/cli) | No |
| Quitar historial obsoleto en un bucle de agente que escribes tú | [`ctxjev-core`](packages/core) | No |
| Conservar detalles clave tras la compactación de Claude Code | [el plugin de Claude Code](packages/claude-plugin) | No |
| Dar herramientas de puntuación a cualquier host MCP | [`ctxjev-mcp`](packages/mcp-server) | Con una clave configurada, extractos enmascarados a Jev salvo que la llamada elija `local` o `recency` |
| Usar ctxjev desde Codex | `ctxjev-mcp`, a través del [plugin de Codex](#codex) | Igual que `ctxjev-mcp` |

## Instalación

Todo necesita Node.js 20 o posterior.

```bash
npm install -g ctxjev-cli     # the ctxjev command
npm install ctxjev-core       # the library
```

`ctxjev-mcp` no necesita instalación: tu host MCP ejecuta `npx ctxjev-mcp@0.7.2` (consulta [Servidor MCP](#servidor-mcp)).

**Plugin de Claude Code.** En Claude Code (CLI o aplicación de escritorio):

```
/plugin marketplace add x96x64/ctxjev
/plugin install ctxjev@ctxjev-plugins
```

No está en npm. El marketplace lo instala desde este repositorio, en la etiqueta de la última versión publicada,
así que solo recibes código publicado.

**Jev (opcional).** Consigue una clave en [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys)
y define `TYPESAFE_API_KEY` en el entorno donde se ejecuta ctxjev.

## Uso

### CLI

`ctxjev analyze` imprime un informe; `ctxjev prune` escribe la transcripción sin las entradas
marcadas como `drop`, en la salida estándar o en `--out <file>`. Lee el formato JSON propio de ctxjev, una
conversación de Anthropic Messages o un `.jsonl` de sesión de Claude Code (solo analyze), y detecta cuál es.

```console
$ ctxjev prune checkout-bug.json --out pruned.json
removed 2 of 7 entries, ~27 tokens · scored by position alone
⚠ removed the first entry (e1): this transcript has no user entry to protect as the original request
```

Por defecto, `prune` nunca elimina la primera entrada del usuario ni las últimas 2 entradas del formato propio de
ctxjev, y nunca toca el primer mensaje ni el último turno de una conversación de Anthropic Messages. Todas las
opciones están en el [README de `ctxjev-cli`](packages/cli/README.md).

### Biblioteca

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

Cualquier otra forma de historial funciona con `pruneContext(entries, goal)`, que recibe entradas simples
`{ id, role, toolName?, content, timestamp }` y devuelve una decisión por entrada. La API completa está en el
[README de `ctxjev-core`](packages/core/README.md).

### Servidor MCP

`ctxjev-mcp` es un servidor MCP por stdio cuyas herramientas son `score_relevance` (una puntuación por entrada) y
`prune_history` (una decisión keep/drop/summarize por entrada, más un informe de ahorro).

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2   # Claude Code
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2    # Codex
```

Omite `--env TYPESAFE_API_KEY=...` para usarlo solo sin conexión. Una herramienta MCP no puede quitar nada del
contexto de su propio host, y el agente paga tokens de salida para enviar su historial como argumentos, así que
llamarla no ahorra tokens por sí sola. Está pensada para frameworks de agentes que actúan según las puntuaciones.
La configuración para otros hosts está en el [README de `ctxjev-mcp`](packages/mcp-server/README.md).

### Plugin de Claude Code

Los hooks de Claude Code pueden leer la transcripción pero no reescribirla, así que el plugin trabaja junto a la
compactación propia de Claude Code:

```
PreCompact             → score the entries since the last compaction; cache the top few
  (Claude Code's own compaction runs, untouched)
SessionStart (compact) → print that cache as a short digest; Claude Code adds it to context
```

Puntúa según tu primera petición más tu última instrucción, o según un objetivo que fijes con
`/ctxjev:set-goal <text>` (para esta sesión, de una compactación a otra). `/ctxjev:status` muestra el
objetivo, qué hizo la última ejecución y por qué, y qué se conservó. Más detalles en el
[README del plugin](packages/claude-plugin/README.md).

### Codex

Codex usa ctxjev a través de `ctxjev-mcp`, como herramientas MCP. Ejecuta la línea `codex mcp add` de arriba, o
instala el paquete de plugin de este repositorio, que registra el mismo servidor y le indica a Codex que le pase
tu `TYPESAFE_API_KEY` (`env_vars`):

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

Eso es todo lo que obtiene Codex: no hay un equivalente para Codex de los hooks de compactación del plugin de
Claude Code, y ctxjev no lee los registros de sesión propios de Codex.

## Configuración

| Método | Ordena por | Usa el objetivo | Envía algo | Predeterminado en |
| --- | --- | --- | --- | --- |
| `recency` | Posición: la más antigua 0, la más nueva 1 (truncamiento simple) | No | No | CLI, biblioteca |
| `local` | Coincidencia de palabras clave con el objetivo, ordenada dentro del lote | Sí | No | Plugin de Claude Code |
| `jev` | El juicio sí/no de Jev sobre la relevancia para el objetivo | Sí | Extractos enmascarados y el objetivo, a TypeSafe AI | Herramientas MCP |

`local` y `jev` combinan su relevancia con la posición de cada entrada: `recencyWeight` (por defecto `0.1`)
indica cuánto cuenta la posición. Una entrada cuya puntuación queda por debajo de `dropBelow` (por defecto `0.3`)
se marca como `drop`, por debajo de `summarizeBelow` (por defecto `0.6`) como `summarize`, y cualquier otra como `keep`.

| Variable de entorno | La usa | Qué hace |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | todo lo que llama a Jev | Tu clave de Jev. Un valor que solo es un marcador sin expandir, como `${TYPESAFE_API_KEY}`, se trata como si no hubiera clave. |
| `CTXJEV_SCORER` | Plugin de Claude Code | `jev` para activar Jev; cualquier otro valor puntúa sin conexión. |
| `CTXJEV_PRESERVE_LIMIT` | Plugin de Claude Code | Cuántas entradas conservar tras una compactación, de 1 a 50 (por defecto 5). |
| `CTXJEV_STATE_DIR` | Plugin de Claude Code | Dónde guarda su estado (por defecto `~/.claude/ctxjev`). |

## Cómo funciona

- **Una solicitud por lote.** Con Jev, cada entrada se convierte en una pregunta de sí o no, y se hacen hasta 50 a la
  vez contra un único estado compartido. Cada lote también ve la actividad más reciente, así que una prueba
  fallida antigua se juzga sabiendo que una ejecución posterior la arregló.
- **La recencia es relativa al lote**, no al reloj, así que una transcripción guardada puntúa igual que una en vivo.
- **A Jev nunca se le pide contar ni escribir.** Los recuentos de tokens salen de un tokenizador, y la decisión
  keep/drop/summarize es un simple umbral sobre la puntuación de Jev.
- **El ahorro cuenta lo que realmente se elimina**, con el tamaño completo de cada entrada, no el extracto que se puntuó.

El razonamiento detrás de cada decisión está en [docs/design-notes.md](docs/design-notes.md).

## Privacidad

- Con `recency` o `local`, no se envía nada a ningún sitio.
- Con `jev`, el objetivo y un extracto breve de cada entrada (no archivos completos ni la salida completa de las
  herramientas) se envían a la API de Jev de TypeSafe AI. Antes se sustituyen por `[REDACTED]` los secretos en
  formatos comunes, y los ids de las entradas no se envían en absoluto. El enmascaramiento es coincidencia de
  patrones: reduce la exposición, pero no puede reconocer todos los secretos, así que no uses `--scorer jev` con un
  registro sensible sin revisarlo antes.
- El plugin de Claude Code guarda su estado en `~/.claude/ctxjev/`, legible solo por ti, nunca en tu proyecto. La
  caché de puntuaciones de la CLI es `~/.cache/ctxjev/score-cache.json` y guarda hashes, no el texto de las transcripciones.

Lo bien que funciona el enmascaramiento, medido sobre líneas escritas sin ver su código, está en
[docs/evaluation.md](docs/evaluation.md#secret-masking-measured-blind). Para informar de una filtración, consulta
[SECURITY.md](SECURITY.md).

## Estado y límites

ctxjev hace lo que describe esta página, pero no se ha demostrado que eso ayude a un agente a terminar su trabajo.
En una [comparación preregistrada](docs/evaluation.md) con <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> tareas que el diseño nunca había
visto, un agente que recibió el historial recortado según el orden de Jev terminó la misma proporción de tareas que
un agente que recibió el truncamiento simple (diferencia en puntos porcentuales, con su intervalo de confianza del 95%:
<!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku --> con Claude Haiku 4.5, <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet --> con Claude Sonnet 5). Según la medida
preregistrada de lo que necesitaba cada tarea, el orden de Jev conservó un <!-- generated:holdout-retention-jev -->23.6%<!-- /generated:holdout-retention-jev --> con un presupuesto
ajustado, menos que un orden aleatorio de las mismas entradas (<!-- generated:holdout-retention-random -->26.5%<!-- /generated:holdout-retention-random -->). El resumen (digest)
del plugin de Claude Code tampoco tiene un efecto demostrado. Por eso, todo salvo las herramientas MCP puntúa sin
conexión por defecto. Las tareas son pequeñas y el conjunto reservado ya está agotado; [docs/evaluation.md](docs/evaluation.md)
tiene todas las cifras, cómo se obtuvieron y lo que no pueden mostrar.

## Documentación

- [docs/evaluation.md](docs/evaluation.md): qué se ha medido y qué no
- [docs/design-notes.md](docs/design-notes.md): por qué funciona como funciona
- READMEs de los paquetes: [`ctxjev-core`](packages/core/README.md), [`ctxjev-cli`](packages/cli/README.md),
  [`ctxjev-mcp`](packages/mcp-server/README.md), [plugin de Claude Code](packages/claude-plugin/README.md)
- [CHANGELOG.md](CHANGELOG.md) y [ROADMAP.md](ROADMAP.md)

## Contribuir

Los issues y las pull requests son bienvenidos. [CONTRIBUTING.md](CONTRIBUTING.md) explica la configuración, las
reglas que sigue cada cambio y cómo se publican las versiones; [AGENTS.md](AGENTS.md) contiene las mismas reglas
completas, para agentes de programación con IA y para personas por igual.

```bash
pnpm install && pnpm build && pnpm test
```

## Seguridad

Informa de las vulnerabilidades en privado, como describe [SECURITY.md](SECURITY.md), no en un issue público.

## Licencia

[MIT](LICENSE). ctxjev es un proyecto independiente, no está afiliado a TypeSafe AI ni a Anthropic, ni cuenta
con su respaldo. Está construido sobre [`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) y el
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) de Anthropic; todas las
dependencias directas usan MIT o ISC. Algunas de sus propias dependencias usan licencia BSD (`fast-uri`, `qs`,
`json-schema-typed`) y piden que también conserves sus avisos; `pnpm licenses list --prod` las enumera todas. El
plugin de Claude Code incluye código de `@typesafe-ai/sdk` y distribuye su aviso en
[`THIRD_PARTY_NOTICES`](packages/claude-plugin/THIRD_PARTY_NOTICES).
