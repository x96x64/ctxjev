import { build } from 'esbuild'
import { readFile, readdir, rm } from 'node:fs/promises'

// Claude Code installs this plugin by cloning its repo, never running an install step, so the
// hooks can't rely on node_modules resolution for cross-package imports (e.g. `ctxjev-core`,
// only linked here via the pnpm workspace). tsc alone leaves those imports bare; bundle the two
// hook entry points so they carry their own dependencies and need nothing but Node itself.
const OUTPUT_FILES = ['preCompact.js', 'sessionStartCompact.js']

await build({
  entryPoints: ['src/preCompact.ts', 'src/sessionStartCompact.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'dist',
  allowOverwrite: true,
  minify: true,
})

// tsconfig.json sets noEmit, so tsc -b (which runs before this script) never writes anything to
// dist/ — but dist/ is committed to git (unlike every other package's), so anything left over
// from before this script existed only goes away if something actually deletes it. Keep dist/
// down to exactly the two files hooks/hooks.json actually invokes.
for (const file of await readdir('dist')) {
  if (!OUTPUT_FILES.includes(file)) await rm(`dist/${file}`)
}

// Guard against silently shipping a broken bundle again — the exact way 0.1.7 and 0.1.8's bugs
// both happened: fail loudly if either entry point still has a non-builtin bare import esbuild
// should have inlined, instead of letting it through to a fresh install's ERR_MODULE_NOT_FOUND.
for (const file of OUTPUT_FILES) {
  const code = await readFile(`dist/${file}`, 'utf8')
  const badImport = code.match(/\bfrom\s*['"](?!\.{1,2}\/|node:)([^'"]+)['"]/)
  if (badImport) {
    throw new Error(`dist/${file} still imports "${badImport[1]}" — esbuild failed to bundle it`)
  }
}
