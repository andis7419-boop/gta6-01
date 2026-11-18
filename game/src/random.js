// random.js — seeded deterministic RNG for Solmar Bay.
// Every system gets its own instance seeded from world.seed, so call order
// in one system can never change the numbers another system draws.
// Deterministic only: no wall clock, no unseeded randomness anywhere.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function nextFloat() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed) {
  // Normalise once so a bad seed (NaN, negative, float) still gives a
  // stable, repeatable stream instead of silently degenerating.
  const cleanSeed = Number.isFinite(seed) ? Math.floor(seed) : 1;
  const next = mulberry32(cleanSeed);
  return {
    next() {
      return next();
    },
    nextInt(min, max) {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi <= lo) return lo;
      return lo + Math.floor(next() * (hi - lo));
    },
    range(min, max) {
      return min + next() * (max - min);
    },
    pick(array) {
      if (!array || array.length === 0) return undefined;
      return array[Math.floor(next() * array.length)];
    },
    chance(p) {
      return next() < p;
    },
    shuffle(array) {
      const out = array.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
  };
}
