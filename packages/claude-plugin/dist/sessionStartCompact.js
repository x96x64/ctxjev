#!/usr/bin/env node

// src/preserve.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
function cachePath(cwd) {
  return join(cwd, ".ctxjev", "preserved-context.json");
}
async function readPreservedContext(cwd) {
  try {
    return JSON.parse(await readFile(cachePath(cwd), "utf8"));
  } catch {
    return void 0;
  }
}

// src/readStdin.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// src/sessionStartCompact.ts
async function main() {
  const input = JSON.parse(await readStdin());
  if (!input.cwd) return;
  const preserved = await readPreservedContext(input.cwd);
  if (!preserved || preserved.entries.length === 0) return;
  const lines = [
    `ctxjev preserved context through compaction (goal: ${preserved.goal}):`,
    ...preserved.entries.map((e) => `- [score ${e.combinedScore.toFixed(2)}] ${e.content}`)
  ];
  console.log(lines.join("\n"));
}
main().catch((err) => {
  console.error("ctxjev sessionStartCompact:", err instanceof Error ? err.message : String(err));
});
