# ctxjev

[en](https://github.com/x96x64/ctxjev/blob/main/README.md) | [ja](https://github.com/x96x64/ctxjev/blob/main/README.ja.md) | [zh](https://github.com/x96x64/ctxjev/blob/main/README.zh.md) | [es](https://github.com/x96x64/ctxjev/blob/main/README.es.md) | [ko](https://github.com/x96x64/ctxjev/blob/main/README.ko.md) | **pt** | [fr](https://github.com/x96x64/ctxjev/blob/main/README.fr.md) | [de](https://github.com/x96x64/ctxjev/blob/main/README.de.md)

<!-- translation-source: README.md sha256=ae7f159f1a78a3c17cc3e875c17eba4968fa5a795a47161d1f19a3ca68bdb039 -->
> Traduzido do README em inglês (português do Brasil). Em caso de diferença, vale a versão em inglês.

**Dá uma pontuação ao histórico de um agente de IA e decide o que manter, descartar ou resumir: offline por
padrão, ou com o [Jev](https://typesafe.ai) da TypeSafe AI, se você optar por ele.**

[![npm: ctxjev-core](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm: ctxjev-cli](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm: ctxjev-mcp](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-core.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-core.svg)](https://nodejs.org)

- **Por padrão, nada sai da sua máquina** com a CLI, a biblioteca, o servidor MCP ou o plugin do Claude Code.
  O Jev é opcional (`--scorer jev`, `scorer: 'jev'`, `scorer: "jev"`, `CTXJEV_SCORER=jev`) e precisa de `TYPESAFE_API_KEY`.
- **O benefício não está comprovado:** em tarefas reservadas (held-out), não se demonstrou que algum método de pontuação
  ajude um agente a concluir mais tarefas do que o simples truncamento. Veja [Situação e limites](#situação-e-limites).

## Experimente em 30 segundos

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

O método de pontuação padrão, `recency`, é o simples truncamento: entradas mais novas pontuam mais, e o objetivo
não é usado. Aqui ele mantém o `ls public/audio`, que não tem relação nenhuma, só por ser o mais recente.
`--scorer local` ordena pela sobreposição de palavras-chave com o objetivo, também offline:

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

## Recursos

- **Métodos de pontuação embutidos, ou o seu próprio:** `recency` (simples truncamento, o padrão), `local`
  (sobreposição de palavras-chave) e `jev` (o julgamento do Jev sobre a relevância para o seu objetivo; opcional).
- **Cortes que mantêm a requisição válida:** `pruneMessages()` remove um `tool_use` junto com seu
  `tool_result`, nunca mexe na primeira mensagem nem no turno mais recente, mantém o que o usuário escreveu e
  informa quanto a mudança custa a um cache de prompts.
- **Um plugin para o Claude Code** que devolve as entradas de maior pontuação logo depois da compactação.
- **Um servidor MCP** com as ferramentas `score_relevance` e `prune_history` para qualquer host MCP.
- **Mascaramento de segredos** em formatos comuns antes de qualquer envio ao Jev (melhor esforço, não exaustivo).
- **Contagem de tokens calculada no código** com `gpt-tokenizer` (uma aproximação do tokenizador do Claude),
  nunca pedida ao Jev.

## Qual eu preciso?

| Você quer… | Use | Envia algo por padrão? |
| --- | --- | --- |
| Ver como uma transcrição pontua, ou cortar uma já salva | [`ctxjev-cli`](packages/cli) | Não |
| Descartar histórico obsoleto em um loop de agente escrito por você | [`ctxjev-core`](packages/core) | Não |
| Preservar detalhes importantes após a compactação do Claude Code | [o plugin do Claude Code](packages/claude-plugin) | Não |
| Dar ferramentas de pontuação a qualquer host MCP | [`ctxjev-mcp`](packages/mcp-server) | Não: só uma chamada que passe `scorer: "jev"` |
| Usar o ctxjev no Codex | `ctxjev-mcp`, pelo [plugin do Codex](#codex) | O mesmo que `ctxjev-mcp` |

## Instalação

Tudo precisa do Node.js 20 ou posterior.

```bash
npm install -g ctxjev-cli     # the ctxjev command
npm install ctxjev-core       # the library
```

O `ctxjev-mcp` não precisa de instalação: seu host MCP executa `npx ctxjev-mcp@0.7.2` (veja [Servidor MCP](#servidor-mcp)).

**Plugin do Claude Code.** No Claude Code (CLI ou aplicativo de desktop):

```
/plugin marketplace add x96x64/ctxjev
/plugin install ctxjev@ctxjev-plugins
```

Ele não está no npm. O marketplace o instala a partir deste repositório, na tag da versão publicada mais recente,
então você recebe apenas código publicado.

**Jev (opcional).** Obtenha uma chave em [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys)
e defina `TYPESAFE_API_KEY` no ambiente em que o ctxjev roda.

## Uso

### CLI

`ctxjev analyze` imprime um relatório; `ctxjev prune` grava a transcrição sem as entradas marcadas
como `drop`, na saída padrão ou em `--out <file>`. Ele lê o formato JSON próprio do ctxjev, uma conversa
Anthropic Messages ou um `.jsonl` de sessão do Claude Code (só analyze), e detecta qual é.

```console
$ ctxjev prune checkout-bug.json --out pruned.json
removed 2 of 7 entries, ~27 tokens · scored by position alone
⚠ removed the first entry (e1): this transcript has no user entry to protect as the original request
```

Por padrão, o `prune` nunca remove a primeira entrada do usuário nem as últimas 2 entradas do formato próprio do
ctxjev, e nunca mexe na primeira mensagem nem no turno mais recente de uma conversa Anthropic Messages. Todas as
opções estão no [README do `ctxjev-cli`](packages/cli/README.md).

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

Qualquer outro formato de histórico funciona com `pruneContext(entries, goal)`, que recebe entradas simples
`{ id, role, toolName?, content, timestamp }` e retorna uma decisão por entrada. A API completa está no
[README do `ctxjev-core`](packages/core/README.md).

### Servidor MCP

O `ctxjev-mcp` é um servidor MCP via stdio cujas ferramentas são `score_relevance` (uma pontuação por entrada) e
`prune_history` (uma decisão keep/drop/summarize por entrada, mais um relatório de economia).

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2   # Claude Code
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2    # Codex
```

As ferramentas pontuam offline (`local`), a menos que a chamada passe `scorer: "jev"`; deixe de fora `--env TYPESAFE_API_KEY=...` se nunca quiser usar o Jev. Uma ferramenta MCP não consegue remover nada do
contexto do próprio host, e o agente paga tokens de saída para enviar o histórico como argumentos, então chamá-la
não economiza tokens por si só. Ela serve para frameworks de agentes que agem com base nas pontuações. A configuração
para outros hosts está no [README do `ctxjev-mcp`](packages/mcp-server/README.md).

### Plugin do Claude Code

Os hooks do Claude Code conseguem ler a transcrição, mas não reescrevê-la, então o plugin trabalha ao lado da
compactação do próprio Claude Code:

```
PreCompact             → score the entries since the last compaction; cache the top few
  (Claude Code's own compaction runs, untouched)
SessionStart (compact) → print that cache as a short digest; Claude Code adds it to context
```

Ele pontua com base no seu primeiro pedido mais a sua instrução mais recente, ou em um objetivo definido com
`/ctxjev:set-goal <text>` (para esta sessão, mesmo após compactações). `/ctxjev:status` mostra o objetivo, o que
a última execução fez e por quê, e o que foi mantido. Mais detalhes no [README do plugin](packages/claude-plugin/README.md).

### Codex

O Codex usa o ctxjev por meio do `ctxjev-mcp`, como ferramentas MCP. Rode a linha `codex mcp add` acima, ou instale
o pacote de plugin deste repositório, que registra o mesmo servidor e diz ao Codex para repassar a ele a sua
`TYPESAFE_API_KEY` (`env_vars`):

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

É só isso que o Codex recebe: não existe para o Codex um equivalente aos hooks de compactação do plugin do
Claude Code, e o ctxjev não lê os logs de sessão do próprio Codex.

## Configuração

| Método | Ordena por | Usa o objetivo | Envia algo | Padrão em |
| --- | --- | --- | --- | --- |
| `recency` | Posição: a mais antiga 0, a mais nova 1 (simples truncamento) | Não | Não | CLI, biblioteca |
| `local` | Sobreposição de palavras-chave com o objetivo, ordenada dentro do lote | Sim | Não | Plugin do Claude Code, ferramentas MCP |
| `jev` | O julgamento sim/não do Jev sobre a relevância para o objetivo | Sim | Trechos mascarados e o objetivo, para a TypeSafe AI | Nenhum: opcional |

`local` e `jev` combinam a relevância com a posição de cada entrada: `recencyWeight` (padrão `0.1`) é o quanto a
posição conta. Uma entrada com pontuação abaixo de `dropBelow` (padrão `0.3`) é marcada como `drop`, abaixo de
`summarizeBelow` (padrão `0.6`) como `summarize`, e qualquer outra como `keep`.

| Variável de ambiente | Usada por | O que faz |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | tudo o que chama o Jev | Sua chave do Jev. Um valor que é só um marcador não expandido, como `${TYPESAFE_API_KEY}`, é tratado como ausência de chave. |
| `CTXJEV_SCORER` | Plugin do Claude Code | `jev` para ativar o Jev; qualquer outro valor pontua offline. |
| `CTXJEV_PRESERVE_LIMIT` | Plugin do Claude Code | Quantas entradas preservar em uma compactação, de 1 a 50 (padrão 5). |
| `CTXJEV_STATE_DIR` | Plugin do Claude Code | Onde ele guarda o estado (padrão `~/.claude/ctxjev`). |

## Como funciona

- **Uma requisição por lote.** Com o Jev, cada entrada vira uma pergunta de sim ou não, e até 50 são feitas de uma
  vez contra um único estado compartilhado. Cada lote também vê a atividade mais recente, então um teste antigo que
  falhou é julgado sabendo que uma execução posterior o corrigiu.
- **A recência é relativa ao lote**, não ao relógio, então uma transcrição salva pontua igual a uma em andamento.
- **Nunca se pede ao Jev que conte nem que escreva.** As contagens de tokens vêm de um tokenizador, e a
  decisão keep/drop/summarize é um limiar simples sobre a pontuação do Jev.
- **A economia conta o que é realmente removido**, pelo tamanho completo de cada entrada, não pelo trecho pontuado.

O raciocínio por trás de cada escolha está em [docs/design-notes.md](docs/design-notes.md).

## Privacidade

- Com `recency` ou `local`, nada é enviado a lugar nenhum.
- Com `jev`, o objetivo e um trecho curto de cada entrada (não arquivos inteiros nem a saída completa das
  ferramentas) são enviados à API do Jev da TypeSafe AI. Antes disso, segredos em formatos comuns são substituídos
  por `[REDACTED]`, e os ids das entradas não são enviados de forma alguma. O mascaramento é correspondência de
  padrões: reduz a exposição, mas não consegue reconhecer todos os segredos, então não use `--scorer jev` em um log sensível sem
  conferi-lo antes.
- O plugin do Claude Code guarda o estado em `~/.claude/ctxjev/`, legível só por você, nunca no seu projeto. O cache
  de pontuações da CLI é `~/.cache/ctxjev/score-cache.json` e guarda hashes, não o texto das transcrições.

A eficácia do mascaramento, medida em linhas escritas sem ver o código dele, está em
[docs/evaluation.md](docs/evaluation.md#secret-masking-measured-blind). Para relatar um vazamento, veja
[SECURITY.md](SECURITY.md).

## Situação e limites

O ctxjev faz o que esta página descreve, mas não foi demonstrado que isso ajude um agente a concluir o trabalho.
Em uma [comparação pré-registrada](docs/evaluation.md) com <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count --> tarefas que o design nunca tinha
visto, um agente que recebeu o histórico cortado pela ordem do Jev concluiu a mesma proporção de tarefas que um
agente que recebeu o simples truncamento (diferença em pontos percentuais, com o intervalo de confiança de 95%:
<!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku --> com Claude Haiku 4.5, <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet --> com Claude Sonnet 5). Na medida
pré-registrada do que cada tarefa precisava, a ordem do Jev manteve <!-- generated:holdout-retention-jev -->23.6%<!-- /generated:holdout-retention-jev --> sob um orçamento
apertado, menos que uma ordem aleatória das mesmas entradas (<!-- generated:holdout-retention-random -->26.5%<!-- /generated:holdout-retention-random -->). O resumo (digest) do
plugin do Claude Code também não tem efeito demonstrado. É por isso que todos os pontos de entrada pontuam offline por padrão. As tarefas são pequenas, e o conjunto reservado agora está esgotado; [docs/evaluation.md](docs/evaluation.md)
traz todos os números, como foram obtidos e o que eles não conseguem mostrar.

## Documentação

- [docs/evaluation.md](docs/evaluation.md): o que foi e o que não foi medido
- [docs/design-notes.md](docs/design-notes.md): por que funciona do jeito que funciona
- READMEs dos pacotes: [`ctxjev-core`](packages/core/README.md), [`ctxjev-cli`](packages/cli/README.md),
  [`ctxjev-mcp`](packages/mcp-server/README.md), [plugin do Claude Code](packages/claude-plugin/README.md)
- [CHANGELOG.md](CHANGELOG.md) e [ROADMAP.md](ROADMAP.md)

## Como contribuir

Issues e pull requests são bem-vindos. O [CONTRIBUTING.md](CONTRIBUTING.md) explica a configuração, as regras que
toda mudança segue e como as versões são publicadas; o [AGENTS.md](AGENTS.md) traz as mesmas regras completas, para
agentes de programação com IA e para pessoas.

```bash
pnpm install && pnpm build && pnpm test
```

## Segurança

Relate vulnerabilidades de forma privada, como descreve o [SECURITY.md](SECURITY.md), e não em uma issue pública.

## Licença

[MIT](LICENSE). O ctxjev é um projeto independente, sem afiliação com a TypeSafe AI nem com a Anthropic e sem o
endosso delas. Ele é construído sobre o [`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk) e o
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) da Anthropic; todas as
dependências diretas usam MIT ou ISC. Algumas das dependências delas usam licença BSD (`fast-uri`, `qs`,
`json-schema-typed`) e pedem que você mantenha também os avisos delas; `pnpm licenses list --prod` lista todas. O
plugin do Claude Code inclui código do `@typesafe-ai/sdk` e distribui o aviso dele em
[`THIRD_PARTY_NOTICES`](packages/claude-plugin/THIRD_PARTY_NOTICES).
