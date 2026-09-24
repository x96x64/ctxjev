/**
 * `«text»` on one line: how ctxjev puts a goal or an excerpt in front of a model as data. An
 * unquoted imperative ("fix computeTotal") reads as a request — in a manual test, Claude Haiku acted
 * on one — so the plugin's digest and status report quote everything they didn't write themselves.
 */
export function quoteAsData(text: string): string {
  return `«${text.replace(/\s+/g, ' ').trim()}»`
}
