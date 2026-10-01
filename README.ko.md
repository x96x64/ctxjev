# ctxjev

[en](https://github.com/x96x64/ctxjev/blob/main/README.md) | [ja](https://github.com/x96x64/ctxjev/blob/main/README.ja.md) | [zh](https://github.com/x96x64/ctxjev/blob/main/README.zh.md) | [es](https://github.com/x96x64/ctxjev/blob/main/README.es.md) | **ko** | [pt](https://github.com/x96x64/ctxjev/blob/main/README.pt.md) | [fr](https://github.com/x96x64/ctxjev/blob/main/README.fr.md) | [de](https://github.com/x96x64/ctxjev/blob/main/README.de.md)

<!-- translation-source: README.md sha256=ae7f159f1a78a3c17cc3e875c17eba4968fa5a795a47161d1f19a3ca68bdb039 -->
> 영어 README를 번역한 문서입니다. 내용이 다를 경우 영어판이 기준입니다.

**AI 에이전트의 이력에 점수를 매기고, 무엇을 남기고 버리고 요약할지 정합니다. 기본적으로 오프라인으로
동작하며, 원하면 TypeSafe AI의 [Jev](https://typesafe.ai)를 쓸 수 있습니다.**

[![npm: ctxjev-core](https://img.shields.io/npm/v/ctxjev-core.svg?label=ctxjev-core)](https://www.npmjs.com/package/ctxjev-core)
[![npm: ctxjev-cli](https://img.shields.io/npm/v/ctxjev-cli.svg?label=ctxjev-cli)](https://www.npmjs.com/package/ctxjev-cli)
[![npm: ctxjev-mcp](https://img.shields.io/npm/v/ctxjev-mcp.svg?label=ctxjev-mcp)](https://www.npmjs.com/package/ctxjev-mcp)
[![CI](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml/badge.svg)](https://github.com/x96x64/ctxjev/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/ctxjev-core.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/ctxjev-core.svg)](https://nodejs.org)

- **기본적으로 아무것도 내 컴퓨터 밖으로 나가지 않습니다.** CLI, 라이브러리, MCP 서버, Claude Code 플러그인 모두 그렇습니다.
  Jev는 직접 선택할 때만 쓰이며(`--scorer jev`, `scorer: 'jev'`, `scorer: "jev"`, `CTXJEV_SCORER=jev`) `TYPESAFE_API_KEY`가 필요합니다.
- **효과는 아직 입증되지 않았습니다.** 홀드아웃(held-out) 과제에서, 어떤 채점 방식도 단순 잘라내기보다 에이전트가
  더 많은 과제를 끝내도록 돕는다는 것이 입증되지 않았습니다. [현황과 한계](#현황과-한계)를 참고하세요.

## 30초 만에 써 보기

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

기본 채점 방식인 `recency`는 단순 잘라내기입니다. 새 항목일수록 점수가 높고, 목표(goal)는 쓰지 않습니다.
이 예에서는 관련 없는 `ls public/audio`도 가장 최신이라는 이유로 남습니다. `--scorer local`은 대신 목표와의
키워드 겹침으로 순위를 매기며, 이것도 오프라인입니다.

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

## 특징

- **내장 채점 방식 또는 직접 만든 함수:** `recency`(단순 잘라내기, 기본값), `local`
  (키워드 겹침), `jev`(목표와의 관련성에 대한 Jev의 판단, 선택 사항).
- **요청이 유효한 상태로 정리:** `pruneMessages()`는 `tool_use`와 그에 대응하는 `tool_result`를 함께 지우고,
  첫 메시지와 최신 턴은 건드리지 않으며, 사용자가 쓴 내용은 남기고, 변경이 프롬프트 캐시에 주는 비용을 보고합니다.
- **Claude Code 플러그인:** 압축(compaction) 직후에 점수가 가장 높은 항목을 컨텍스트에 다시 넣어 줍니다.
- **MCP 서버:** 어떤 MCP 호스트에서도 쓸 수 있는 `score_relevance`와 `prune_history` 도구.
- **비밀 값 마스킹:** Jev로 무엇이든 보내기 전에 흔한 형식의 비밀 값을 가립니다(최선의 노력일 뿐 완전하지 않음).
- **토큰 수는 코드로 계산:** `gpt-tokenizer`(Claude 토크나이저의 근사치)를 쓰며, Jev에게 세도록 하지 않습니다.

## 무엇을 써야 하나요?

| 하고 싶은 일 | 사용할 것 | 기본적으로 무언가를 보내나요? |
| --- | --- | --- |
| 기록이 어떻게 채점되는지 보거나, 저장된 기록을 정리 | [`ctxjev-cli`](packages/cli) | 아니요 |
| 직접 작성한 에이전트 루프에서 오래된 기록을 정리 | [`ctxjev-core`](packages/core) | 아니요 |
| Claude Code의 압축 후에도 중요한 세부 사항을 유지 | [Claude Code 플러그인](packages/claude-plugin) | 아니요 |
| 어떤 MCP 호스트에든 채점 도구를 제공 | [`ctxjev-mcp`](packages/mcp-server) | 아니요: `scorer: "jev"`를 넘긴 호출만 보냄 |
| Codex에서 ctxjev 사용 | [Codex 플러그인](#codex)을 통한 `ctxjev-mcp` | `ctxjev-mcp`와 같음 |

## 설치

모두 Node.js 20 이상이 필요합니다.

```bash
npm install -g ctxjev-cli     # the ctxjev command
npm install ctxjev-core       # the library
```

`ctxjev-mcp`는 설치할 필요가 없습니다. MCP 호스트가 `npx ctxjev-mcp@0.7.2`를 실행합니다([MCP 서버](#mcp-서버) 참고).

**Claude Code 플러그인.** Claude Code(CLI 또는 데스크톱 앱)에서:

```
/plugin marketplace add x96x64/ctxjev
/plugin install ctxjev@ctxjev-plugins
```

npm에는 없습니다. 마켓플레이스가 이 저장소의 최신 릴리스 태그에서 설치하므로, 릴리스된 코드만 받게 됩니다.

**Jev(선택 사항).** [console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys)에서 키를 받고,
ctxjev가 실행되는 환경에 `TYPESAFE_API_KEY`를 설정하세요.

## 사용법

### CLI

`ctxjev analyze`는 보고서를 출력하고, `ctxjev prune`은 `drop`으로 표시된 항목을 뺀 기록을
표준 출력이나 `--out <file>`에 씁니다. ctxjev 고유의 JSON 형식, Anthropic Messages 대화,
Claude Code 세션의 `.jsonl`(analyze 전용)을 읽으며, 어느 것인지 자동으로 판별합니다.

```console
$ ctxjev prune checkout-bug.json --out pruned.json
removed 2 of 7 entries, ~27 tokens · scored by position alone
⚠ removed the first entry (e1): this transcript has no user entry to protect as the original request
```

기본적으로 `prune`은 ctxjev 고유 형식에서 첫 사용자 항목과 마지막 2개 항목을 절대 지우지 않으며,
Anthropic Messages 대화의 첫 메시지와 최신 턴은 건드리지 않습니다. 모든 옵션은
[`ctxjev-cli` README](packages/cli/README.md)에 있습니다.

### 라이브러리

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

다른 형태의 기록은 `pruneContext(entries, goal)`로 처리할 수 있습니다. 이 함수는 단순한
`{ id, role, toolName?, content, timestamp }` 항목을 받아 항목마다 판정을 돌려줍니다. 전체 API는
[`ctxjev-core` README](packages/core/README.md)에 있습니다.

### MCP 서버

`ctxjev-mcp`는 stdio MCP 서버이며, 도구는 `score_relevance`(항목별 점수)와
`prune_history`(항목별 keep/drop/summarize 판정과 절감 보고서)입니다.

```bash
claude mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2   # Claude Code
codex mcp add ctxjev --env TYPESAFE_API_KEY=... -- npx ctxjev-mcp@0.7.2    # Codex
```

도구는 호출이 `scorer: "jev"`를 넘기지 않는 한 오프라인(`local`)으로 채점합니다. Jev를 전혀 쓰지 않으려면 `--env TYPESAFE_API_KEY=...`를 빼세요. MCP 도구는 호스트 자신의 컨텍스트에서 아무것도
지울 수 없고, 에이전트는 기록을 인수로 보내기 위해 출력 토큰을 지불하므로, 호출만으로는 토큰이 절약되지 않습니다.
점수를 보고 행동하는 에이전트 프레임워크를 위한 것입니다. 다른 호스트의 설정은
[`ctxjev-mcp` README](packages/mcp-server/README.md)에 있습니다.

### Claude Code 플러그인

Claude Code의 훅(hook)은 대화 기록을 읽을 수는 있지만 다시 쓸 수는 없으므로, 플러그인은 Claude Code
자체의 압축과 함께 동작합니다.

```
PreCompact             → score the entries since the last compaction; cache the top few
  (Claude Code's own compaction runs, untouched)
SessionStart (compact) → print that cache as a short digest; Claude Code adds it to context
```

첫 요청과 최신 지시를 합친 것, 또는 `/ctxjev:set-goal <text>`로 정한 목표를 기준으로 채점합니다
(이 세션 동안, 압축을 거쳐도 유지). `/ctxjev:status`는 목표, 지난 실행이 무엇을 왜 했는지, 무엇을 남겼는지
보여 줍니다. 자세한 내용은 [플러그인 README](packages/claude-plugin/README.md)를 참고하세요.

### Codex

Codex는 `ctxjev-mcp`를 통해 MCP 도구로 ctxjev를 씁니다. 위의 `codex mcp add` 줄을 실행하거나,
이 저장소의 플러그인 묶음을 설치하세요. 플러그인은 같은 서버를 등록하고, 여러분의 `TYPESAFE_API_KEY`를
서버에 넘기도록 Codex에 설정합니다(`env_vars`).

```bash
codex plugin marketplace add x96x64/ctxjev
codex plugin add ctxjev@ctxjev-plugins
```

Codex에서 쓸 수 있는 것은 여기까지입니다. Claude Code 플러그인의 압축 훅에 해당하는 것이 Codex용으로는 없고,
ctxjev는 Codex 자체의 세션 로그를 읽지 않습니다.

## 설정

| 채점 방식 | 순위 기준 | 목표 사용 | 무언가를 보내는지 | 기본값으로 쓰는 곳 |
| --- | --- | --- | --- | --- |
| `recency` | 위치: 가장 오래된 것 0, 가장 새로운 것 1(단순 잘라내기) | 아니요 | 아니요 | CLI, 라이브러리 |
| `local` | 목표와의 키워드 겹침, 배치 안에서 순위화 | 예 | 아니요 | Claude Code 플러그인, MCP 도구 |
| `jev` | 목표와의 관련성에 대한 Jev의 예/아니요 판단 | 예 | 마스킹된 발췌와 목표를 TypeSafe AI로 | 없음: 선택 사항 |

`local`과 `jev`는 관련성에 각 항목의 위치를 섞습니다. `recencyWeight`(기본값 `0.1`)는 위치를 얼마나 반영할지입니다.
점수가 `dropBelow`(기본값 `0.3`)보다 낮은 항목은 `drop`, `summarizeBelow`(기본값 `0.6`)보다 낮은 항목은
`summarize`, 나머지는 `keep`으로 표시됩니다.

| 환경 변수 | 사용하는 곳 | 하는 일 |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Jev를 호출하는 모든 것 | Jev 키. `${TYPESAFE_API_KEY}`처럼 확장되지 않은 플레이스홀더뿐인 값은 키가 없는 것으로 봅니다. |
| `CTXJEV_SCORER` | Claude Code 플러그인 | `jev`로 Jev 사용. 그 밖의 값은 오프라인으로 채점. |
| `CTXJEV_PRESERVE_LIMIT` | Claude Code 플러그인 | 압축을 넘어 가져갈 항목 수, 1에서 50(기본값 5). |
| `CTXJEV_STATE_DIR` | Claude Code 플러그인 | 상태를 저장하는 위치(기본값 `~/.claude/ctxjev`). |

## 동작 방식

- **배치 단위로 요청합니다.** Jev를 쓰면 각 항목이 예/아니요 질문이 되고, 최대 50개를 하나의 공유 상태에 대해
  한꺼번에 묻습니다. 각 배치는 최신 작업 상황도 보므로, 예전에 실패했던 테스트도 나중의 실행에서 고쳐졌다는 사실을 알고서 판단됩니다.
- **최신성은 실제 시각이 아니라 배치 안에서 상대적으로 정해지므로**, 저장된 기록도 진행 중인 기록과 같은 점수를 받습니다.
- **Jev에게는 세거나 글을 쓰게 하지 않습니다.** 토큰 수는 토크나이저로 세고, keep/drop/summarize 판정은
  Jev 점수에 단순한 임곗값을 적용한 것입니다.
- **절감량은 실제로 지운 만큼만 셉니다.** 채점한 발췌가 아니라 각 항목의 원래 크기로 셉니다.

각 선택의 이유는 [docs/design-notes.md](docs/design-notes.md)에 있습니다.

## 개인 정보

- `recency`나 `local`을 쓰면 어디에도 아무것도 보내지 않습니다.
- `jev`를 쓰면 목표와 각 항목의 짧은 발췌(파일 전체나 도구 출력 전체가 아님)를 TypeSafe AI의 Jev API로 보냅니다.
  흔한 형식의 비밀 값은 먼저 `[REDACTED]`로 바꾸며, 항목 ID는 전혀 보내지 않습니다. 마스킹은 패턴 대조이므로
  노출을 줄일 수는 있지만 모든 비밀 값을 알아볼 수는 없습니다. 내용을 확인하지 않은 민감한 로그에는 `--scorer jev`를 쓰지 마세요.
- Claude Code 플러그인은 상태를 `~/.claude/ctxjev/`에 저장합니다. 본인만 읽을 수 있고, 프로젝트 안에는 절대 두지 않습니다.
  CLI의 점수 캐시는 `~/.cache/ctxjev/score-cache.json`이며, 기록 본문이 아니라 해시를 저장합니다.

마스킹 코드를 보지 않고 작성된 줄로 측정한 마스킹 성능은
[docs/evaluation.md](docs/evaluation.md#secret-masking-measured-blind)에 있습니다. 유출을 신고하려면
[SECURITY.md](SECURITY.md)를 참고하세요.

## 현황과 한계

ctxjev는 이 페이지에 쓴 대로 동작하지만, 그것이 에이전트가 일을 끝내는 데 도움이 되는지는 입증되지 않았습니다.
설계에 쓰지 않은 <!-- generated:holdout-task-count -->6<!-- /generated:holdout-task-count -->개 과제에 대한 [사전 등록 비교](docs/evaluation.md)에서, Jev의 순위로 정리한
기록을 받은 에이전트와 단순 잘라내기 기록을 받은 에이전트가 과제를 끝낸 비율은 같았습니다(차이는 퍼센트포인트,
95% CI 포함: Claude Haiku 4.5에서 <!-- generated:holdout-diff-haiku -->0 [0, 0]<!-- /generated:holdout-diff-haiku -->, Claude Sonnet 5에서 <!-- generated:holdout-diff-sonnet -->0 [0, 0]<!-- /generated:holdout-diff-sonnet -->).
각 과제에 필요했던 정보를 기준으로 한 사전 등록 지표에서, 빠듯한 예산 아래 Jev 순위로 남긴 비율은 <!-- generated:holdout-retention-jev -->23.6%<!-- /generated:holdout-retention-jev -->로,
같은 항목을 무작위로 늘어놓았을 때(<!-- generated:holdout-retention-random -->26.5%<!-- /generated:holdout-retention-random -->)보다 적었습니다. Claude Code 플러그인의 다이제스트(digest)도
입증된 효과가 없습니다. 그래서 모든 진입점이 기본적으로 오프라인으로 채점합니다. 과제는 작고,
홀드아웃 과제 집합은 이제 다 써 버렸습니다. 모든 수치와 그것을 얻은 방법, 그리고 그 수치로 알 수 없는 것은
[docs/evaluation.md](docs/evaluation.md)에 있습니다.

## 문서

- [docs/evaluation.md](docs/evaluation.md): 무엇을 측정했고 무엇을 측정하지 않았는지
- [docs/design-notes.md](docs/design-notes.md): 왜 이렇게 동작하는지
- 패키지 README: [`ctxjev-core`](packages/core/README.md), [`ctxjev-cli`](packages/cli/README.md),
  [`ctxjev-mcp`](packages/mcp-server/README.md), [Claude Code 플러그인](packages/claude-plugin/README.md)
- [CHANGELOG.md](CHANGELOG.md)와 [ROADMAP.md](ROADMAP.md)

## 기여

이슈와 풀 리퀘스트를 환영합니다. [CONTRIBUTING.md](CONTRIBUTING.md)에는 개발 환경 설정, 모든 변경이 따르는 규칙,
릴리스 방법이 있습니다. [AGENTS.md](AGENTS.md)에는 AI 코딩 에이전트와 사람 모두를 위한 같은 규칙의 전문이 있습니다.

```bash
pnpm install && pnpm build && pnpm test
```

## 보안

취약점은 공개 이슈가 아니라 [SECURITY.md](SECURITY.md)에 적힌 방법으로 비공개로 신고해 주세요.

## 라이선스

[MIT](LICENSE). ctxjev는 독립 프로젝트로, TypeSafe AI나 Anthropic과 제휴하지 않았으며 승인을 받지도 않았습니다.
[`@typesafe-ai/sdk`](https://www.npmjs.com/package/@typesafe-ai/sdk)와 Anthropic의
[`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)를 바탕으로 만들어졌고,
직접 의존성은 모두 MIT 또는 ISC입니다. 직접 의존성이 다시 의존하는 패키지 중 일부(`fast-uri`, `qs`, `json-schema-typed`)는 BSD 라이선스이며,
그 고지도 함께 유지하도록 요구합니다. `pnpm licenses list --prod`로 모두 확인할 수 있습니다. Claude Code 플러그인은
`@typesafe-ai/sdk`의 코드를 포함하며, 그 고지를 [`THIRD_PARTY_NOTICES`](packages/claude-plugin/THIRD_PARTY_NOTICES)에 담아 배포합니다.
