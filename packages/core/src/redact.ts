/**
 * Best-effort masking of common secret shapes before any text leaves the machine (sent to Jev) or
 * lands on disk (the Claude Code plugin's cache). Real transcripts routinely contain keys pasted
 * into chat or echoed by a tool — this catches the recognizable formats, not every possible
 * secret, so it narrows the exposure rather than eliminating it.
 */
const REDACTED = '[REDACTED]'

const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g, // Anthropic (sk-ant-...), OpenAI, and similar
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
]

const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi

// NAME=value / NAME: value where NAME looks like a credential. The name is kept (it's useful
// context — "the API key was set") and only the value is masked.
const ASSIGNMENT = /\b([A-Za-z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"']{8,})\3/gi

export function redactSecrets(text: string): string {
  let out = text
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED)
  out = out.replace(BEARER, `$1${REDACTED}`)
  // A purely numeric value (maxTokens=100000) is a setting, not a secret.
  out = out.replace(ASSIGNMENT, (match, name, sep, quote, value) =>
    /^\d+$/.test(value) || value === REDACTED ? match : `${name}${sep}${quote}${REDACTED}${quote}`,
  )
  return out
}
