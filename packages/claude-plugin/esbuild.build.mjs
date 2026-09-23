import { build } from 'esbuild'
import { builtinModules } from 'node:module'
import { readdir, rm } from 'node:fs/promises'

// Claude Code installs this plugin by cloning its repo, never running an install step, so the
// hooks can't rely on node_modules resolution for cross-package imports (e.g. `ctxjev-core`,
// only linked here via the pnpm workspace). Bundle the two hook entry points so they carry their
// own dependencies and need nothing but Node itself.
const OUTPUT_FILES = ['preCompact.js', 'sessionStartCompact.js']

const result = await build({
  entryPoints: ['src/preCompact.ts', 'src/sessionStartCompact.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'dist',
  allowOverwrite: true,
  minify: true,
  metafile: true,
})

// dist/ is committed (unlike every other package's), so keep it to exactly what hooks.json runs.
for (const file of await readdir('dist')) {
  if (!OUTPUT_FILES.includes(file)) await rm(`dist/${file}`)
}

// Any import left in the output that isn't a Node builtin would fail with ERR_MODULE_NOT_FOUND on
// a fresh install (0.1.8's bug). esbuild's metafile lists real imports, so this can't be fooled by
// string contents in the minified code.
const isBuiltin = (path) => path.startsWith('node:') || builtinModules.includes(path)
for (const [outFile, output] of Object.entries(result.metafile.outputs)) {
  const unbundled = [...new Set(output.imports.filter((i) => i.external && !isBuiltin(i.path)).map((i) => i.path))]
  if (unbundled.length > 0) {
    throw new Error(`${outFile} still imports ${unbundled.join(', ')} — esbuild failed to bundle it`)
  }
}
