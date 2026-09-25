/**
 * `«text»` on one line: how ctxjev puts a goal or an excerpt in front of a model as data. An
 * unquoted imperative ("fix computeTotal") reads as a request — in a manual test, Claude Haiku acted
 * on one — so the plugin's digest and status report quote everything they didn't write themselves.
 *
 * The quoted text can't end its own quote or break out of the text around it: whitespace (newlines
 * included) collapses to one space, so it can't start a line of its own; `«` and `»` inside it
 * become `‹` and `›`, so it can't close the quote and carry on as if ctxjev had written the rest;
 * and a `<` that starts something tag-like (`</system-reminder>`, `<instructions>`) becomes `‹`,
 * since the digest reaches the model inside Claude Code's own `<system-reminder>` tags.
 */
export function quoteAsData(text: string): string {
  const safe = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/«/g, '‹')
    .replace(/»/g, '›')
    .replace(/<(?=[/!?]?[A-Za-z])/g, '‹')
  return `«${safe}»`
}
