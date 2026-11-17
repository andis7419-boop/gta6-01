export function mulberry32(seed) { let a = seed >>> 0;
  return function () { a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function createRng(seed) { const next = mulberry32(seed);
  return { next() { return next();
    }, nextInt(min, max) { if (max <= min) throw new Error('createRng.nextInt: empty range');
      return min + Math.floor(next() * (max - min));
    }, range(min, max) { if (max < min) throw new Error('createRng.range: inverted range');
      return min + next() * (max - min);
    }, pick(array) { if (!array || array.length === 0) { throw new Error('createRng.pick: empty array');
      }
      return array[Math.floor(next() * array.length)];
    }, chance(p) { return next() < p;
    }, shuffle(array) { const out = array.slice();
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    }, };
}
