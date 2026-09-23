import { delayFor, shouldRetry } from './retryPolicy.js'

// `send` performs one attempt and throws { status } or { code } on failure.
// `sleep` and `random` are injectable for tests.
export async function request(send, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send()
    } catch (failure) {
      if (!shouldRetry(failure)) throw failure
      await sleep(delayFor(attempt, random))
    }
  }
}
