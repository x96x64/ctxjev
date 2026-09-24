// Anthropic Messages history → Claude Code's transcript format (.jsonl), shared by plugin.mjs and
// digest-coverage.mjs. Records are chained by parentUuid the way Claude Code writes them, so
// `claude --resume` can also load the file (plugin.mjs's real compaction), not just the hooks.
export function toTranscript(messages, sessionId, cwd) {
  const start = Date.parse('2026-09-23T01:00:00Z')
  let parentUuid = null
  return messages
    .map((m, i) => {
      const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      const record = {
        parentUuid,
        isSidechain: false,
        userType: 'external',
        type: m.role,
        uuid,
        sessionId,
        cwd,
        timestamp: new Date(start + i * 1000).toISOString(),
        message:
          m.role === 'assistant'
            ? { id: `msg_${i}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content, stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }
            : { role: 'user', content: m.content },
      }
      parentUuid = uuid
      return JSON.stringify(record)
    })
    .join('\n')
}

/** A transcript entry id from parseClaudeCodeTranscript → the messagesToEntries id for the same entry. */
export function messageEntryId(transcriptId) {
  const m = /^00000000-0000-4000-8000-(\d{12})(?::text:(\d+))?$/.exec(transcriptId)
  if (!m) return `tool:${transcriptId}`
  return m[2] === undefined ? `msg:${Number(m[1])}` : `msg:${Number(m[1])}:${m[2]}`
}
