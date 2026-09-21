import { build } from 'esbuild'

// Claude Code installs this plugin by cloning its repo, never running an install step, so the
// hooks can't rely on node_modules resolution for cross-package imports (e.g. `ctxjev-core`,
// only linked here via the pnpm workspace). tsc alone leaves those imports bare; bundle the two
// hook entry points so they carry their own dependencies and need nothing but Node itself.
await build({
  entryPoints: ['src/preCompact.ts', 'src/sessionStartCompact.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'dist',
  allowOverwrite: true,
})
