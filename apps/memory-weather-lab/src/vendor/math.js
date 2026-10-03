// @ts-nocheck
/* ESM wrapper around apps/memory-weather/src/math.js. Factory body is copied from the sibling file. */
const api = (function () {
  "use strict";

  const EPS = 1e-12;

  function assertFinite(value, label) {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    return value;
  }

  function assertVec(vec, length, label = "vector") {
    if (!Array.isArray(vec) || vec.length !== length) {
      throw new TypeError(`${label} must be an array of length ${length}`);
    }
    for (let i = 0; i < vec.length; i += 1) assertFinite(vec[i], `${label}[${i}]`);
    return vec;
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  function dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
    return sum;
  }

  function norm(a) {
    return Math.sqrt(dot(a, a));
  }

  function add(a, b) {
    return a.map((value, i) => value + b[i]);
  }

  function sub(a, b) {
    return a.map((value, i) => value - b[i]);
  }

  function scale(a, scalar) {
    return a.map((value) => value * scalar);
  }

  function mix(a, b, amount) {
    return a.map((value, i) => value * (1 - amount) + b[i] * amount);
  }

  function mean(vectors, dimension) {
    if (!vectors.length) return Array(dimension).fill(0);
    const out = Array(dimension).fill(0);
    for (const vector of vectors) {
      for (let i = 0; i < dimension; i += 1) out[i] += vector[i];
    }
    return out.map((value) => value / vectors.length);
  }

  function normalize(a, targetNorm = 1) {
    const length = norm(a);
    if (length < EPS) return a.map(() => 0);
    return scale(a, targetNorm / length);
  }

  function boundVector(a, componentLimit = 2, radialLimit = 2) {
    let out = a.map((value) => clamp(value, -componentLimit, componentLimit));
    const length = norm(out);
    if (length > radialLimit) out = scale(out, radialLimit / length);
    return out;
  }

  function cosine(a, b) {
    const denom = norm(a) * norm(b);
    return denom < EPS ? 0 : clamp(dot(a, b) / denom, -1, 1);
  }

  function distance(a, b) {
    return norm(sub(a, b));
  }

  function entropyProxy(a) {
    const weights = a.map((value) => Math.abs(value));
    const sum = weights.reduce((acc, value) => acc + value, 0);
    if (sum < EPS) return 0;
    let entropy = 0;
    for (const weight of weights) {
      if (weight > EPS) {
        const p = weight / sum;
        entropy -= p * Math.log(p);
      }
    }
    return entropy / Math.log(Math.max(2, a.length));
  }

  function mix32(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return x >>> 0;
  }

  function fnv1a32(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function keyedUint(seed, stream, step = 0, index = 0) {
    let value = mix32((seed >>> 0) ^ fnv1a32(String(stream)));
    value = mix32(value ^ Math.imul((step + 1) >>> 0, 0x9e3779b1));
    return mix32(value ^ Math.imul((index + 1) >>> 0, 0x85ebca6b));
  }

  function keyedUniform(seed, stream, step = 0, index = 0) {
    return (keyedUint(seed, stream, step, index) + 0.5) / 4294967296;
  }

  function keyedGaussian(seed, stream, step = 0, index = 0) {
    const u1 = Math.max(EPS, keyedUniform(seed, `${stream}:u1`, step, index));
    const u2 = keyedUniform(seed, `${stream}:u2`, step, index);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function roundNumber(value, digits = 8) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function quantize(value, digits = 8) {
    if (Array.isArray(value)) return value.map((item) => quantize(item, digits));
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = quantize(value[key], digits);
      return out;
    }
    return typeof value === "number" ? roundNumber(value, digits) : value;
  }

  function stableStringify(value, digits = 8) {
    return JSON.stringify(quantize(value, digits));
  }

  function fnv1a64(text) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    const bytes = typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(text)
      : Array.from(Buffer.from(text, "utf8"));
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, "0");
  }

  function contentHash(value, digits = 8) {
    return `mw-fnv64:${fnv1a64(stableStringify(value, digits))}`;
  }

  function textVector(text, dimension = 12, targetNorm = 1.2) {
    const seed = fnv1a32(String(text).normalize("NFC").toLowerCase());
    const vector = [];
    for (let i = 0; i < dimension; i += 1) {
      const a = keyedUniform(seed, "text-encoder", i, 0) * 2 - 1;
      const b = keyedUniform(seed, "text-encoder", i, 1) * 2 - 1;
      vector.push(0.72 * a + 0.28 * b);
    }
    return normalize(vector, targetNorm);
  }

  function matrixVector(matrix, vector) {
    return matrix.map((row) => dot(row, vector));
  }

  function transposeVector(matrix, vector) {
    const width = matrix[0].length;
    const out = Array(width).fill(0);
    for (let row = 0; row < matrix.length; row += 1) {
      for (let col = 0; col < width; col += 1) out[col] += matrix[row][col] * vector[row];
    }
    return out;
  }

  return {
    EPS,
    add,
    assertFinite,
    assertVec,
    boundVector,
    clamp,
    contentHash,
    cosine,
    distance,
    dot,
    entropyProxy,
    fnv1a32,
    keyedGaussian,
    keyedUint,
    keyedUniform,
    matrixVector,
    mean,
    mix,
    norm,
    normalize,
    quantize,
    roundNumber,
    scale,
    stableStringify,
    sub,
    textVector,
    transposeVector
  };
}
)();
export default api;
