// 側面投影テクスチャを用意する（ブラウザ専用。canvas を使う）。
//   - appearance.texture_side があれば、その画像（三面図の側面図を切り抜いたもの）を読む
//   - 無ければ base_colors と markings から模様を描く
// どちらも「頭が左の側面図」で、textureBounds(spec) の範囲を写したものとして扱う。

import * as THREE from 'three';
import { bodyCurves, textureBounds } from './fish-builder.js';
import { rng } from './math.js';

export async function loadFishTextures(spec, baseUrl) {
  const ap = spec.appearance ?? {};
  if (ap.texture_side) {
    const url = new URL(ap.texture_side, baseUrl).href;
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { side: tex };
  }
  return { side: paintSideTexture(spec) };
}

export function paintSideTexture(spec, width = 1024) {
  const b = textureBounds(spec);
  const W = width, H = Math.max(64, Math.round((W * (b.y1 - b.y0)) / (b.x1 - b.x0)));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const px = (x) => ((x - b.x0) / (b.x1 - b.x0)) * W;
  const py = (y) => ((b.y1 - y) / (b.y1 - b.y0)) * H;
  const c = bodyCurves(spec);
  const ap = spec.appearance ?? {};
  const col = { dorsal: '#4a5a52', flank: '#a8b0a0', ventral: '#e8e6dc', ...(ap.base_colors ?? {}) };
  const yr = (x, r) => c.bottom(x) + r * (c.top(x) - c.bottom(x)); // r: 腹縁0〜背縁1

  // 鰭（体より先に描き、体で付け根を覆う）
  for (const fin of spec.fins ?? []) {
    if (!fin.outline) continue;
    ctx.save();
    ctx.beginPath();
    fin.outline.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.closePath();
    ctx.globalAlpha = fin.opacity ?? ap.fin_opacity ?? 0.85;
    ctx.fillStyle = fin.color ?? ap.fin_color ?? col.flank;
    ctx.fill();
    ctx.clip();
    // 鰭条：輪郭の点から付け根へ線を引く
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = fin.ray_color ?? 'rgba(40,40,40,0.8)';
    ctx.lineWidth = Math.max(1, W / 700);
    const step = Math.max(1, Math.floor(fin.outline.length / (fin.rays ?? 14)));
    for (let i = 0; i < fin.outline.length; i += step) {
      const [x, y] = fin.outline[i];
      ctx.beginPath();
      ctx.moveTo(px(x), py(y));
      if (fin.type === 'caudal') ctx.lineTo(px(c.endX - 0.01), py(yr(c.endX, 0.5)));
      else if (y > yr(Math.min(x, c.endX), 0.5)) ctx.lineTo(px(x), py(c.top(Math.min(x, c.endX))));
      else ctx.lineTo(px(x), py(c.bottom(Math.min(x, c.endX))));
      ctx.stroke();
    }
    if (fin.edge_color) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = fin.edge_color;
      ctx.lineWidth = (fin.edge_width ?? 0.006) * W;
      ctx.beginPath();
      fin.outline.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
      ctx.closePath();
      ctx.stroke();
    }
    for (const m of fin.markings ?? []) drawMarking(ctx, m, { px, py, yr, W, endX: c.endX, seed: spec.seed });
    ctx.restore();
  }

  // 体：列ごとに背→体側→腹のグラデーション
  const vs = ap.ventral_start ?? 0.55; // 上から何割で腹の色に変わり始めるか
  for (let i = 0; i < W; i++) {
    const x = b.x0 + ((i + 0.5) / W) * (b.x1 - b.x0);
    if (x < 0 || x > c.endX) continue;
    const yt = py(c.top(x)), yb = py(c.bottom(x));
    if (yb - yt < 0.5) continue;
    const g = ctx.createLinearGradient(0, yt, 0, yb);
    g.addColorStop(0, col.dorsal);
    g.addColorStop(Math.max(0.05, vs - 0.25), col.dorsal);
    g.addColorStop(vs, col.flank);
    g.addColorStop(Math.min(0.98, vs + 0.25), col.ventral);
    g.addColorStop(1, col.ventral);
    ctx.fillStyle = g;
    ctx.fillRect(i - 0.5, yt - 2, 2, yb - yt + 4);
  }

  // 模様（体の輪郭で切り抜く）
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) { const x = (c.endX * i) / 200; i ? ctx.lineTo(px(x), py(c.top(x))) : ctx.moveTo(px(x), py(c.top(x))); }
  for (let i = 200; i >= 0; i--) { const x = (c.endX * i) / 200; ctx.lineTo(px(x), py(c.bottom(x))); }
  ctx.closePath();
  ctx.clip();
  for (const m of ap.markings ?? []) drawMarking(ctx, m, { px, py, yr, W, endX: c.endX, seed: spec.seed });
  ctx.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function drawMarking(ctx, m, { px, py, yr, W, endX, seed }) {
  ctx.save();
  ctx.globalAlpha = m.opacity ?? 0.9;
  ctx.fillStyle = m.color ?? '#222';
  ctx.strokeStyle = m.color ?? '#222';
  if (m.blur) ctx.filter = `blur(${m.blur * W}px)`;
  const yOf = (x, mm) => (mm.y != null ? mm.y : yr(Math.min(x, endX), mm.r ?? 0.5));
  switch (m.type) {
    case 'band': { // 横帯（縦じま）。r0〜r1 の高さだけ塗る
      const w = m.width ?? 0.03, tilt = Math.tan(((m.tilt_deg ?? 0) * Math.PI) / 180);
      const r0 = m.r0 ?? -0.1, r1 = m.r1 ?? 1.1;
      ctx.beginPath();
      const steps = 24;
      for (let k = 0; k <= steps; k++) { const r = r0 + ((r1 - r0) * k) / steps; const x = m.x - w / 2 + tilt * (r - 0.5) * 0.2; ctx[k ? 'lineTo' : 'moveTo'](px(x), py(yr(Math.min(Math.max(x, 0), endX), r))); }
      for (let k = steps; k >= 0; k--) { const r = r0 + ((r1 - r0) * k) / steps; const x = m.x + w / 2 + tilt * (r - 0.5) * 0.2; ctx.lineTo(px(x), py(yr(Math.min(Math.max(x, 0), endX), r))); }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'stripe': // 縦帯（体軸に沿う線）。r（相対高さ）か y で位置を決める
    case 'lateral_line': {
      const x0 = m.x0 ?? 0.05, x1 = m.x1 ?? endX;
      ctx.lineWidth = (m.width ?? (m.type === 'lateral_line' ? 0.003 : 0.015)) * W;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k <= 60; k++) { const x = x0 + ((x1 - x0) * k) / 60; ctx[k ? 'lineTo' : 'moveTo'](px(x), py(yOf(x, m))); }
      ctx.stroke();
      break;
    }
    case 'spots': { // 小斑点。範囲 [x0,x1] × [r0,r1] にばらまく
      const r = rng(m.seed ?? seed ?? 7), n = m.count ?? 30;
      for (let k = 0; k < n; k++) {
        const x = (m.x0 ?? 0.1) + r() * ((m.x1 ?? endX) - (m.x0 ?? 0.1));
        const rr = (m.r0 ?? 0.2) + r() * ((m.r1 ?? 0.9) - (m.r0 ?? 0.2));
        const rad = (m.radius ?? 0.006) * (1 + (r() - 0.5) * (m.radius_jitter ?? 0.4)) * W;
        ctx.beginPath();
        ctx.ellipse(px(x), py(yr(Math.min(x, endX), rr)), rad * (m.aspect ?? 1), rad, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'blotch': // 斑紋。中心と半径（楕円）
    case 'ocellus': { // 眼状斑：縁取り付き
      const x = m.x, y = yOf(x, m), rx = (m.rx ?? m.radius ?? 0.02) * W, ry = (m.ry ?? m.radius ?? 0.02) * W;
      if (m.type === 'ocellus' && m.ring_color) {
        ctx.fillStyle = m.ring_color;
        ctx.beginPath(); ctx.ellipse(px(x), py(y), rx * 1.35, ry * 1.35, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = m.color ?? '#111';
      }
      ctx.beginPath(); ctx.ellipse(px(x), py(y), rx, ry, ((m.angle_deg ?? 0) * Math.PI) / 180, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'patch': { // 多角形（spec 座標）
      ctx.beginPath();
      m.polygon.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](px(x), py(y)));
      ctx.closePath();
      if (m.outline_color) { // 縁取り（クマノミの白帯の黒い縁など）
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = m.outline_color;
        ctx.lineWidth = (m.outline_width ?? 0.008) * W * 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
      }
      ctx.fill();
      break;
    }
    case 'reticulate': { // 網目模様：鱗の縁を暗くする
      const sc = (m.scale_size ?? 0.025) * W;
      ctx.lineWidth = Math.max(1, sc * 0.12);
      for (let gx = px(m.x0 ?? 0.15); gx < px(m.x1 ?? endX); gx += sc * 0.8) {
        for (let gy = 0, row = 0; gy < ctx.canvas.height; gy += sc * 0.55, row++) {
          ctx.beginPath();
          ctx.arc(gx + (row % 2) * sc * 0.4, gy, sc * 0.5, -Math.PI * 0.4, Math.PI * 0.4); // 鱗の後縁（尾側に凸）
          ctx.stroke();
        }
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
