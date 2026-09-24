/**
 * Where `text` stops being valid JSON: the offset of the first character that can't be part of a
 * JSON document, or `text.length` when it ends too early. `undefined` if it's valid. Only called
 * after JSON.parse has already failed, to say where — Node's own message gives an offset for some
 * errors and not others ("Unexpected token ','" has none).
 */
export function jsonErrorOffset(text: string): number | undefined {
  let i = 0
  const invalid = new Error('invalid JSON')
  const fail = (): never => {
    throw invalid
  }
  const skipWhitespace = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++
  }
  const expect = (ch: string) => {
    if (text[i] !== ch) fail()
    i++
  }
  const string = () => {
    expect('"')
    while (i < text.length) {
      const c = text[i]
      if (c === '"') return void i++
      if (c < ' ') fail()
      i += c === '\\' ? 2 : 1
    }
    fail()
  }
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  // Iterative, not recursive: a deeply nested file must not overflow the stack while reporting an error.
  const value = () => {
    const closers: string[] = []
    for (;;) {
      skipWhitespace()
      const c = text[i]
      if (c === '{' || c === '[') {
        i++
        skipWhitespace()
        const close = c === '{' ? '}' : ']'
        if (text[i] === close) i++
        else {
          closers.push(close)
          if (close === '}') {
            string()
            skipWhitespace()
            expect(':')
          }
          continue
        }
      } else if (c === '"') string()
      else if (c === '-' || (c >= '0' && c <= '9')) {
        NUMBER.lastIndex = i
        if (!NUMBER.exec(text)) fail()
        i = NUMBER.lastIndex
      } else {
        const literal = ['true', 'false', 'null'].find((l) => text.startsWith(l, i))
        if (!literal) fail()
        i += literal!.length
      }
      // A value is complete: continue the enclosing object or array, or finish.
      for (;;) {
        const close = closers.at(-1)
        if (close === undefined) return
        skipWhitespace()
        if (text[i] === ',') {
          i++
          if (close === '}') {
            skipWhitespace()
            string()
            skipWhitespace()
            expect(':')
          }
          break
        }
        expect(close)
        closers.pop()
      }
    }
  }
  try {
    value()
    skipWhitespace()
    return i === text.length ? undefined : i
  } catch (err) {
    if (err === invalid) return Math.min(i, text.length)
    throw err
  }
}
