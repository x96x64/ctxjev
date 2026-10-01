/**
 * Performance checks a slow or busy machine can't fail: how the time grows from n to 10n, not a
 * wall-clock limit. The fifth audit (docs/audits/2026-10-01-audit-5-ja.md, 5c and improvement 9)
 * found main's CI turned red by a 5-second limit under coverage instrumentation, which slows every
 * size alike and so leaves the ratio where it was. Linear work grows about 10×, quadratic about
 * 100×; LINEAR_RATIO_LIMIT sits between them.
 */
export const LINEAR_RATIO_LIMIT = 30
// A 10n run quicker than this is too quick to time reliably, and too quick to be quadratic at the
// sizes these tests use (a quadratic pass over 100,000 characters takes seconds).
export const TOO_FAST_TO_MATTER_MS = 25

export type Growth = { n: number; small: number; large: number; ratio: number }

/**
 * Times `run(n)` and `run(10 * n)`, each the best of `repeats` runs (1 when a cache inside the code
 * under test would make a repeat faster than a first run), after `warmUp` if given.
 */
export async function measureGrowth(run: (n: number) => unknown, n: number, { repeats = 2, warmUp }: { repeats?: number; warmUp?: () => unknown } = {}): Promise<Growth> {
  await warmUp?.()
  const time = async (size: number) => {
    let best = Infinity
    for (let i = 0; i < repeats; i++) {
      const start = performance.now()
      await run(size)
      best = Math.min(best, performance.now() - start)
    }
    return best
  }
  const small = await time(n)
  const large = await time(10 * n)
  return { n, small, large, ratio: large / Math.max(small, 0.001) }
}

export const isLinear = ({ large, ratio }: Growth) => large < TOO_FAST_TO_MATTER_MS || ratio < LINEAR_RATIO_LIMIT

export const describeGrowth = ({ n, small, large, ratio }: Growth) =>
  `${small.toFixed(1)} ms for n = ${n.toLocaleString('en-US')}, ${large.toFixed(1)} ms for 10n: ×${ratio.toFixed(1)} (linear is about ×10; the limit is ×${LINEAR_RATIO_LIMIT})`
