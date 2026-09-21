function asKnownBlock(raw) {
    if (typeof raw !== 'object' || raw === null || !('type' in raw))
        return undefined;
    return raw;
}
const MAX_CONTENT_LENGTH = 300;
function truncate(text) {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > MAX_CONTENT_LENGTH ? `${oneLine.slice(0, MAX_CONTENT_LENGTH - 1)}…` : oneLine;
}
function toolResultText(content) {
    if (typeof content === 'string')
        return content;
    return content
        .map((block) => (block.type === 'text' ? block.text ?? '' : `[${block.type}]`))
        .filter(Boolean)
        .join(' ');
}
function toTimestampMs(timestamp) {
    if (!timestamp)
        return 0;
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? 0 : parsed;
}
export function parseClaudeCodeTranscript(jsonl) {
    const entries = [];
    const pendingToolUse = new Map();
    for (const line of jsonl.split('\n')) {
        if (!line.trim())
            continue;
        let record;
        try {
            record = JSON.parse(line);
        }
        catch {
            continue; // a malformed or truncated line shouldn't take down the whole parse
        }
        const timestamp = toTimestampMs(record.timestamp);
        const content = record.message?.content;
        if (record.type === 'user' && typeof content === 'string') {
            entries.push({ id: record.uuid ?? `user-${timestamp}`, role: 'user', content: truncate(content), timestamp });
            continue;
        }
        if (!Array.isArray(content))
            continue;
        for (const [index, raw] of content.entries()) {
            const block = asKnownBlock(raw);
            if (!block)
                continue;
            if (block.type === 'text' && record.type === 'assistant') {
                entries.push({
                    id: `${record.uuid ?? timestamp}:text:${index}`,
                    role: 'assistant',
                    content: truncate(block.text),
                    timestamp,
                });
            }
            else if (block.type === 'tool_use') {
                pendingToolUse.set(block.id, { name: block.name, input: block.input, timestamp });
            }
            else if (block.type === 'tool_result') {
                const pending = pendingToolUse.get(block.tool_use_id);
                const name = pending?.name ?? 'unknown_tool';
                const resultText = toolResultText(block.content);
                entries.push({
                    id: block.tool_use_id,
                    role: 'tool',
                    toolName: name,
                    content: truncate(`${name}: ${resultText}`),
                    timestamp: pending?.timestamp ?? timestamp,
                });
            }
        }
    }
    return entries;
}
//# sourceMappingURL=transcript.js.map