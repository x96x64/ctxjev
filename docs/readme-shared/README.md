# Shared README sections

Each file here is one section that every package README carries, word for word: the npm page shows
only the README inside the package, so each has to stand on its own. A package README marks where
a section goes with `<!-- shared:NAME -->` … `<!-- /shared:NAME -->`, and
`node scripts/readmes.mjs --write` copies the section in. CI fails if a copy differs.

Links here are written relative to a package directory (`../../docs/…`), which is where the copies
live. When a package is packed for npm, `scripts/readmes.mjs --pack` rewrites every relative link
to an absolute GitHub URL at the release's tag.
