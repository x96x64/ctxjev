# ctxjev-cli

Analyze an AI agent transcript and see what [Jev](https://typesafe.ai) would keep, drop, or
summarize — plain-text report or `--json`.

```bash
npm install -g ctxjev-cli
export TYPESAFE_API_KEY=...   # console.typesafe.ai/settings/keys — no waitlist

ctxjev analyze transcript.jsonl --goal "Fix the checkout double-charge bug."
```

Accepts two formats, auto-detected: ctxjev's own `{ goal?, entries }` JSON, or a real Claude Code
session `.jsonl` transcript (goal inferred from your most recent chat message unless `--goal`
overrides it).

Full docs, design notes, and example transcripts live in the main repo:
**[github.com/x96x64/ctxjev](https://github.com/x96x64/ctxjev)**.

## License

MIT
