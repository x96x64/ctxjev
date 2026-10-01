/**
 * The Jev API key the environment actually holds, or why there isn't one. A value that is nothing
 * but a variable reference (`${TYPESAFE_API_KEY}`, `$TYPESAFE_API_KEY`, `%TYPESAFE_API_KEY%`) is a
 * placeholder some host didn't expand, not a key: Codex passes an Agent Plugins bundle's
 * `"TYPESAFE_API_KEY": "${TYPESAFE_API_KEY}"` to the MCP server literally, and taking that for a key
 * sent masked excerpts to Jev only for Jev to refuse them. Every place that decides whether Jev can
 * be called goes through this, so none of them sends anything without a real key.
 */
const PLACEHOLDER = /^(?:\$\{[^{}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)$/

/** The usable key in `env.TYPESAFE_API_KEY`, trimmed; undefined if it's unset, blank, or a placeholder. */
export function typesafeApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.TYPESAFE_API_KEY?.trim()
  if (!value || PLACEHOLDER.test(value)) return undefined
  return value
}

/** Why there's no usable key (one sentence, without the key), or undefined if there is one. */
export function missingTypesafeApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (typesafeApiKey(env) !== undefined) return undefined
  const value = env.TYPESAFE_API_KEY?.trim()
  // Only a placeholder is ever quoted back: it matched PLACEHOLDER, so it holds no secret.
  return value ? `TYPESAFE_API_KEY is ${JSON.stringify(value)}, an unexpanded placeholder, not a key` : 'TYPESAFE_API_KEY is not set'
}
