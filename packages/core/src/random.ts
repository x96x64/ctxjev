/**
 * A seeded pseudo-random number generator (mulberry32), returning numbers in [0, 1). For evals and
 * tests that must print the same thing on every run; not for anything that needs real randomness.
 */
export function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
