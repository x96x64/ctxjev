# ctxjev-core

Score AI agent context for relevance with [Jev](https://typesafe.ai) (TypeSafe AI's typed-decision
model), and decide what to keep, drop, or summarize.

```bash
npm install ctxjev-core
```

```ts
import { pruneContext } from 'ctxjev-core'

const decisions = await pruneContext(
  entries, // your agent's tool-call / message history
  'Fix a bug where checkout charges customers twice on a slow network retry.',
)
```

Requires `TYPESAFE_API_KEY` in the environment (get one at
[console.typesafe.ai/settings/keys](https://console.typesafe.ai/settings/keys), no waitlist).

This package is the host-agnostic engine behind [`ctxjev-cli`](https://www.npmjs.com/package/ctxjev-cli)
and [`ctxjev-mcp`](https://www.npmjs.com/package/ctxjev-mcp). Full docs, design notes, and the
Claude Code plugin live in the main repo:
**[github.com/x96x64/ctxjev](https://github.com/x96x64/ctxjev)**.

## License

MIT
