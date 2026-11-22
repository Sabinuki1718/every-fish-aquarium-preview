// 補間・乱数などの小さな数値ユーティリティ。ブラウザと Node の両方で動く（three.js 非依存）。

/** 決定的な乱数（mulberry32）。同じ seed なら同じレイアウト・同じ模様になる。 */
export function rng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * 単調3次補間（Fritsch–Carlson）。輪郭のオーバーシュートを防ぐ。
 * xs は昇順。範囲外は端の値で止める。
 */
export function monotoneCubic(xs, ys) {
  const n = xs.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / ((xs[i + 1] - xs[i]) || 1e-9));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    const h = xs[hi] - xs[lo], t = (x - xs[lo]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo]
      + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
  };
}

/** [[x, v], ...] または数値から、x→v の関数を作る。 */
export function curveOf(value, fallback = 0) {
  if (value == null) return () => fallback;
  if (typeof value === 'number') return () => value;
  const pts = [...value].sort((a, b) => a[0] - b[0]);
  return monotoneCubic(pts.map((p) => p[0]), pts.map((p) => p[1]));
}

/** 多角形の内外判定（偶奇規則）。 */
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 値ノイズ（1D/2D）。岩や地形の凹凸に使う。 */
export function valueNoise2(seed = 1) {
  const r = rng(seed), perm = new Float32Array(512);
  for (let i = 0; i < 512; i++) perm[i] = r();
  const h = (x, y) => perm[((x * 73856093) ^ (y * 19349663)) & 511];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
  };
}

export function fbm2(seed = 1, octaves = 4) {
  const n = valueNoise2(seed);
  return (x, y) => {
    let s = 0, a = 0.5, f = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      s += a * n(x * f + o * 17.1, y * f - o * 9.7);
      norm += a; a *= 0.5; f *= 2;
    }
    return s / norm;
  };
}

/** '#rrggbb' → [r,g,b]（0〜1） */
export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
