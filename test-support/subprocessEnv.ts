import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Nothing listens here: a request to it fails at once, locally, instead of reaching the real API. */
export const CLOSED_PORT_URL = 'http://127.0.0.1:9'

// What Node itself needs to run on each platform. Nothing else from the developer's environment.
const PASSTHROUGH = ['PATH', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']

// A home directory that doesn't exist, so a code path that forgets its state-dir override can't
// read or write the developer's real ~/.claude (session logs included).
const NO_HOME = join(tmpdir(), 'ctxjev-test-home-does-not-exist')

/**
 * The environment for a test's subprocess: an allowlist, never `process.env` itself. A
 * TYPESAFE_API_KEY or ANTHROPIC_API_KEY in the developer's shell must not reach a test meant to run
 * offline, and TYPESAFE_BASE_URL points at a closed local port, so even a test that sets a (fake)
 * key can't send anything off the machine. `extra` adds variables; an `undefined` value removes one.
 */
export function subprocessEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = { TYPESAFE_BASE_URL: CLOSED_PORT_URL, HOME: NO_HOME, USERPROFILE: NO_HOME, CLAUDE_CONFIG_DIR: join(NO_HOME, '.claude'), NO_COLOR: '1' }
  for (const name of PASSTHROUGH) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name]
    else env[name] = value
  }
  return env
}
