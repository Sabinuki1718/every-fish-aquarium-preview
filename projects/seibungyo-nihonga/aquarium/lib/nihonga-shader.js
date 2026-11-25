/*!
 * nihonga-shader.js — 日本画風レンダリング（three.js r170 用 自作シェーダー）
 *
 *  彩色  : 岩絵具調の減色・筆跡（モデル座標に固定）・藍寄りの段階影
 *  墨線  : 3Dから毎フレーム輪郭を抽出し、画面上の運筆方向で 留め・跳ね・払い を付ける
 *  仕上げ: 和紙（画面に固定）・輪郭外へのにじみ
 *
 *  [拡張 2026-11-25] mesh.userData.nihongaDynamic = true で、CPUで動かした頂点に墨線を追従させる（青文魚の鰭・口・鰓の動き用）。
 *
 *  使い方:
 *    import { createNihonga } from './nihonga-shader.js';
 *    const nihonga = createNihonga(THREE, renderer, { lineWidth: 12 });
 *    nihonga.add(model);                 // 対象のモデル（Object3D）を登録
 *    nihonga.setSize();                  // 画面サイズが変わったら呼ぶ
 *    nihonga.render(scene, camera);      // renderer.render の代わりに毎フレーム呼ぶ
 */
export function createNihonga(T, renderer, opts = {}) {
  const DPR = renderer.getPixelRatio();
  let camera = null;
  /* ---- 共通GLSL：3Dノイズ ---- */
  const NOISE = `
  float h3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
  float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
   return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
              mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
  float fbm(vec3 p){float a=.5,s=0.;for(int k=0;k<4;k++){s+=a*vn(p);p=p*2.03+7.1;a*=.5;}return s/.9375;}`;

  const VERT = `
  uniform float uObjScale;
  varying vec2 vUv; varying vec3 vP; varying vec3 vN; varying float vDepth;
  void main(){
    vUv=uv; vP=position*uObjScale;           // モデル座標（長さ≒1に正規化）→筆跡がモデルに貼り付く
    vN=normalize(normalMatrix*normal);
    vec4 mv=modelViewMatrix*vec4(position,1.); vDepth=-mv.z;
    gl_Position=projectionMatrix*mv;
  }`;

  /* 彩色パス：岩絵具・筆跡・段階影 */
  const U = { uBrush: { value: opts.brush ?? 1 }, uBands: { value: opts.bands ?? 3 } };
  const PAINT = NOISE + `
  uniform sampler2D map; uniform float uBrush,uBands;
  varying vec2 vUv; varying vec3 vP; varying vec3 vN;
  void main(){
    vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;
    vec3 c=texture2D(map,vUv).rgb;
    float l=dot(c,vec3(.299,.587,.114));
    c=mix(vec3(l),c,.78);                       // 岩絵具らしく彩度を落とす
    c=mix(c,floor(c*5.+.5)/5.,.3);              // 色数を少し絞る
    // 筆跡：魚の前後方向(x)に長い刷毛目＋ゆらぎ
    float warp=fbm(vP*3.);
    float n=fbm(vP*vec3(4.,26.,26.)+warp*1.6);
    float pool=1.-smoothstep(0.,.05,abs(n-.5)); // 筆の縁の絵具溜まり
    c*=mix(1.,.72+.5*n,uBrush);
    c=mix(c,c*c*1.1,pool*.7*uBrush);
    // 段階影：境界を筆跡でにじませる（光は画面基準で左上から）
    vec3 L=normalize(vec3(-.45,.75,.55));
    float d=dot(N,L)*.5+.5+(fbm(vP*vec3(2.,9.,9.)+3.)-.5)*.35*uBrush;
    float b=uBands<2.5? smoothstep(.47,.53,d) : .5*smoothstep(.38,.44,d)+.5*smoothstep(.64,.70,d);
    c=mix(c*vec3(.5,.56,.72),c,.15+.85*b);      // 影は黒でなく藍に寄せる
    c=min(c*1.03,vec3(.95,.92,.85));            // 明部は紙の地色を残す
    gl_FragColor=vec4(c,1.);
  }`;

  /* 情報パス：法線・奥行き・部位ID（＋魚体に貼り付いた線の太さ） */
  const INFO = NOISE + `
  uniform float uId; varying vec3 vP; varying vec3 vN; varying float vDepth;
  void main(){
    vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;
    float w=fbm(vP*2.2+11.);
    gl_FragColor=vec4(N.xy*.5+.5,vDepth,(uId+.15+.7*w)/16.);
  }`;

  /* 仕上げ：和紙・にじみ */
  const COMP = `
  uniform sampler2D tCol,tInf; uniform vec2 uRes; uniform float uPx;
  varying vec2 vUv;
  float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
  float washi(vec2 px){
    float g=n2(px*.9)*.5+n2(px*.21)*.5, f=0.;
    for(int k=0;k<3;k++){float a=float(k)*2.1+.4;vec2 q=mat2(cos(a),-sin(a),sin(a),cos(a))*px;
      f=max(f,smoothstep(.86,.97,n2(vec2(q.x*.04,q.y*.45)+float(k)*13.)));}
    return 1.-.06*g+.025*f;
  }
  void main(){
    vec2 px=gl_FragCoord.xy/uPx;
    vec3 paper=vec3(.925,.893,.82);
    float wa=washi(px);
    vec4 c0=texture2D(tInf,vUv);
    vec3 col;
    if(c0.w<.01){                                  // 背景：和紙＋輪郭外への淡いにじみ
      vec3 acc=vec3(0.);float w=0.;
      for(int k=0;k<8;k++){float a=float(k)*.785398+.3;vec2 o=vec2(cos(a),sin(a))*6.*uPx/uRes;
        if(texture2D(tInf,vUv+o).w>.01){acc+=texture2D(tCol,vUv+o).rgb;w+=1.;}}
      col=paper;
      if(w>0.) col=mix(paper,paper*acc/w*1.08,.2*(w/8.)*(.5+n2(px*.08)));
      col*=wa;
    } else col=texture2D(tCol,vUv).rgb*wa;
    gl_FragColor=vec4(col,1.);
  }`;

  /* ---------- 筆線：輪郭を3Dから抽出し、画面上の向きで留め・跳ね・払いを付ける ---------- */
  const STROKE_V = `
  uniform sampler2D tInf; uniform vec2 uRes; uniform float uEps;
  attribute vec2 aS; attribute vec3 aC;            // aS: 筆の進行距離(px)と幅方向(-1..1) / aC: 中心の画面位置と奥行き
  varying vec2 vS; varying float vVis;
  float dAt(vec2 p){float d=texture2D(tInf,p/uRes).z; return d<=0.? 1e9 : d;}
  void main(){
    vS=aS; vec2 c=aC.xy; float o=3.;
    float m=max(dAt(c),max(max(dAt(c+vec2(o,0.)),dAt(c-vec2(o,0.))),max(dAt(c+vec2(0.,o)),dAt(c-vec2(0.,o)))));   // 周りが全部手前なら隠れている
    vVis=aC.z<=m+uEps? 1. : 0.;                     // 手前の鰭などに隠れる線は描かない
    gl_Position=vec4(position.xy,0.,1.);
  }`;
  const STROKE_F = `
  uniform float uPx; uniform vec3 uInkColor; varying vec2 vS; varying float vVis;
  float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
  void main(){
    if(vVis<.5) discard;
    float edge=1.-smoothstep(.72,1.,abs(vS.y));
    float dry=n2(vec2(vS.x/uPx*.03,vS.y*3.2+5.));  // 飛白：筆の進む向きに沿ったかすれ
    gl_FragColor=vec4(uInkColor,edge*(1.-.55*smoothstep(.62,.86,dry)));
  }`;
  const MAXV = 120000;
  const sPos = new Float32Array(MAXV * 3), sS = new Float32Array(MAXV * 2), sC = new Float32Array(MAXV * 3);
  const sGeo = new T.BufferGeometry();
  sGeo.setAttribute('position', new T.BufferAttribute(sPos, 3).setUsage(T.DynamicDrawUsage));
  sGeo.setAttribute('aS', new T.BufferAttribute(sS, 2).setUsage(T.DynamicDrawUsage));
  sGeo.setAttribute('aC', new T.BufferAttribute(sC, 3).setUsage(T.DynamicDrawUsage));
  const sMat = new T.ShaderMaterial({ uniforms: { tInf: { value: null }, uRes: { value: new T.Vector2() }, uEps: { value: opts.occlusionEps ?? .004 }, uPx: { value: DPR }, uInkColor: { value: new T.Color().setHex(opts.inkColor ?? 0x1a1a21, T.LinearSRGBColorSpace) } },
    vertexShader: STROKE_V, fragmentShader: STROKE_F, transparent: true, depthTest: false, depthWrite: false });
  const sMesh = new T.Mesh(sGeo, sMat); sMesh.frustumCulled = false;
  const strokeScene = new T.Scene(); strokeScene.add(sMesh);

  let nv = 0, BW = 1, BH = 1;
  function pushV(x, y, s, a, cx, cy, d) {
    if (nv >= MAXV) return;
    sPos[nv * 3] = x / BW * 2 - 1; sPos[nv * 3 + 1] = y / BH * 2 - 1; sPos[nv * 3 + 2] = 0;
    sS[nv * 2] = s; sS[nv * 2 + 1] = a; sC[nv * 3] = cx; sC[nv * 3 + 1] = cy; sC[nv * 3 + 2] = d; nv++;
  }

  /* 3D側の準備：頂点を溶接し、鰭の縁（境界辺）は形が変わらないので先に繋いでおく */
  function buildChains(adj) {
    const used = new Set(), out = [], ek = (a, b) => a < b ? a + ':' + b : b + ':' + a;
    const walk = (s, closedTry) => {
      const ch = [s]; let cur = s;
      for (;;) {
        const nx = adj[cur].find(n => !used.has(ek(cur, n)));
        if (nx === undefined) break;
        used.add(ek(cur, nx)); if (nx === s) return { ch, closed: true };
        ch.push(nx); cur = nx; if (adj[cur].length !== 2) break;
      }
      return { ch, closed: false };
    };
    for (let i = 0; i < adj.length; i++) if (adj[i].length && adj[i].length !== 2)
      while (adj[i].some(n => !used.has(ek(i, n)))) out.push(walk(i));
    for (let i = 0; i < adj.length; i++) while (adj[i].some(n => !used.has(ek(i, n)))) out.push(walk(i));
    return out.filter(c => c.ch.length > 2);
  }
  function prepStroke(mesh) {
    const g = mesh.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array;
    const map = new Map(), wid = new Int32Array(P.length / 3), wp = [], wn = [];
    for (let v = 0; v < wid.length; v++) {
      const k = Math.round(P[3 * v] * 2e6) + ',' + Math.round(P[3 * v + 1] * 2e6) + ',' + Math.round(P[3 * v + 2] * 2e6);
      let id = map.get(k); if (id === undefined) { id = wp.length / 3; map.set(k, id); wp.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); wn.push(0, 0, 0); }
      wid[v] = id; wn[3 * id] += N[3 * v]; wn[3 * id + 1] += N[3 * v + 1]; wn[3 * id + 2] += N[3 * v + 2];
    }
    const n = wp.length / 3;
    for (let i = 0; i < n; i++) { const l = Math.hypot(wn[3 * i], wn[3 * i + 1], wn[3 * i + 2]) || 1; wn[3 * i] /= l; wn[3 * i + 1] /= l; wn[3 * i + 2] /= l; }
    // [拡張] mesh.userData.nihongaContourFaces（三角形ごとに 1=線を取る / 0=取らない）で、輪郭を取る面を限る（薄い鰭は縁だけ）
    const cmask = mesh.userData.nihongaContourFaces;
    const F = []; for (let f = 0; f < I.length; f += 3) { if (cmask && !cmask[f / 3]) continue; const a = wid[I[f]], b = wid[I[f + 1]], c = wid[I[f + 2]]; if (a !== b && b !== c && a !== c) F.push(a, b, c); }
    // contourFilter(mesh, a, b, c) で、輪郭線を引かない面を除外できる（a,b,c は [x,y,z]）
    const filt = opts.contourFilter, F2 = [];
    for (let f = 0; f < F.length; f += 3) { const q = k => [wp[3 * F[k]], wp[3 * F[k] + 1], wp[3 * F[k] + 2]];
      if (!filt || filt(mesh, q(f), q(f + 1), q(f + 2))) F2.push(F[f], F[f + 1], F[f + 2]); }
    const cnt = new Float32Array(n); for (let v = 0; v < wid.length; v++) cnt[wid[v]]++;   // [拡張] 動く形の線を追うための対応表
    return { mesh, wp: new Float32Array(wp), wn: new Float32Array(wn), F: new Int32Array(F2), n, gv: new Float32Array(n), wid, cnt };
  }
  /* 毎フレーム：頂点法線と視線の内積が0になる所＝なめらかな輪郭線 */
  function contourChains(S, camL) {
    const { wp, wn, F, n, gv } = S;
    for (let v = 0; v < n; v++) {
      const dx = camL.x - wp[3 * v], dy = camL.y - wp[3 * v + 1], dz = camL.z - wp[3 * v + 2];
      gv[v] = (wn[3 * v] * dx + wn[3 * v + 1] * dy + wn[3 * v + 2] * dz) / Math.hypot(dx, dy, dz);
    }
    const key = new Map(), pts = [], adj = [];
    const ep = (a, b) => { const k = a < b ? a * n + b : b * n + a; let i = key.get(k);
      if (i === undefined) { const t = gv[a] / (gv[a] - gv[b]); i = pts.length; key.set(k, i); adj.push([]);
        pts.push([wp[3 * a] + (wp[3 * b] - wp[3 * a]) * t, wp[3 * a + 1] + (wp[3 * b + 1] - wp[3 * a + 1]) * t, wp[3 * a + 2] + (wp[3 * b + 2] - wp[3 * a + 2]) * t]); }
      return i; };
    for (let f = 0; f < F.length; f += 3) {
      const a = F[f], b = F[f + 1], c = F[f + 2], sa = gv[a] > 0, sb = gv[b] > 0, sc = gv[c] > 0;
      if (sa === sb && sb === sc) continue;
      const e = []; if (sa !== sb) e.push(ep(a, b)); if (sb !== sc) e.push(ep(b, c)); if (sc !== sa) e.push(ep(c, a));
      if (e.length === 2) { adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); }
    }
    return buildChains(adj).map(c => ({ closed: c.closed, pts: c.ch.map(i => pts[i]) }));
  }

  /* 画面上の折れ角で筆を分け、向きから終筆の形を決める */
  const V3 = new T.Vector3();
  let W0 = 5;
  function project(mesh, p) {
    V3.set(p[0], p[1], p[2]).applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    const d = -V3.z; V3.applyMatrix4(camera.projectionMatrix);
    return [(V3.x * .5 + .5) * BW, (V3.y * .5 + .5) * BH, d];
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  function strokesFromChain(Praw, closed) {
    const minD = 1.5 * DPR; let Q = [Praw[0]];
    for (const p of Praw) if (dist(p, Q[Q.length - 1]) >= minD) Q.push(p);
    if (closed && Q.length > 2 && dist(Q[0], Q[Q.length - 1]) < minD) Q.pop();
    if (Q.length < 4) return;
    const n = Q.length, I = i => closed ? (i % n + n) % n : Math.max(0, Math.min(n - 1, i));
    for (let pass = 0; pass < 2; pass++) Q = Q.map((p, i) => (!closed && (i === 0 || i === n - 1)) ? p :
      [(Q[I(i - 1)][0] + 2 * p[0] + Q[I(i + 1)][0]) / 4, (Q[I(i - 1)][1] + 2 * p[1] + Q[I(i + 1)][1]) / 4, p[2]]);
    const win = 6 * DPR;
    const reach = (i, sg) => { let j = i; for (let k = 0; k < n; k++) { const nj = j + sg; if (!closed && (nj < 0 || nj >= n)) break; j = nj; if (dist(Q[I(j)], Q[i]) >= win) break; } return I(j); };
    const away = (i, sg) => { const j = reach(i, sg); return norm(Q[j][0] - Q[i][0], Q[j][1] - Q[i][1]); };
    const ang = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!closed && (i < 2 || i > n - 3)) continue;
      const a = away(i, -1), b = away(i, 1);
      ang[i] = Math.PI - Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
    }
    const corners = [];
    for (let i = 0; i < n; i++) { if (ang[i] < .95) continue; let mx = true;
      for (let k = -4; k <= 4; k++) if (k && ang[I(i + k)] > ang[i]) mx = false;
      if (mx && (!closed ? true : true)) corners.push(i); }
    let cuts = corners.slice();
    if (closed && !cuts.length) {   // 角のない輪：上端と下端で左右2画に分ける
      let hi = 0, lo = 0; Q.forEach((p, i) => { if (p[1] > Q[hi][1]) hi = i; if (p[1] < Q[lo][1]) lo = i; });
      cuts = [hi, lo].sort((a, b) => a - b); cuts.soft = true;
    }
    const pieces = [];
    if (closed) {
      for (let k = 0; k < cuts.length; k++) {
        const a = cuts[k], b = cuts[(k + 1) % cuts.length], len = ((b - a + n) % n) || n, idx = [];
        for (let j = 0; j <= len; j++) idx.push(I(a + j));
        pieces.push({ idx, aC: !cuts.soft, bC: !cuts.soft, aAway: away(a, -1), bAway: away(b, 1) });
      }
    } else {
      const cs = [0, ...cuts, n - 1];
      for (let k = 0; k + 1 < cs.length; k++) { const a = cs[k], b = cs[k + 1], idx = []; for (let j = a; j <= b; j++) idx.push(j);
        pieces.push({ idx, aC: k > 0, bC: k + 2 < cs.length, aAway: away(a, -1), bAway: away(b, 1) }); }
    }
    for (const pc of pieces) {
      let pts = pc.idx.map(i => Q[i]); if (pts.length < 3) continue;
      let { aC, bC, aAway, bAway } = pc;
      const dx = pts[pts.length - 1][0] - pts[0][0], dy = pts[pts.length - 1][1] - pts[0][1];
      // 運筆の向き：横画は左→右、縦画は上→下（画面のyは上向き）
      if (Math.abs(dx) > Math.abs(dy) ? dx < 0 : dy > 0) { pts.reverse(); [aC, bC] = [bC, aC]; [aAway, bAway] = [bAway, aAway]; }
      const m = pts.length, tEnd = norm(pts[m - 1][0] - pts[Math.max(0, m - 4)][0], pts[m - 1][1] - pts[Math.max(0, m - 4)][1]);
      let endT = 'harai';
      if (bC) endT = tEnd[1] < -.55 ? 'hane' : Math.abs(tEnd[0]) > .6 ? 'tome' : 'harai';
      emitStroke(pts, aC ? 'press' : 'iri', endT, bAway, tEnd);
    }
  }
  function emitStroke(pts, startT, endT, nextDir, tEnd) {
    const m = pts.length, s = [0];
    for (let i = 1; i < m; i++) s.push(s[i - 1] + dist(pts[i], pts[i - 1]));
    const L = s[m - 1]; if (L < 3 * DPR) return;
    const W = W0 * Math.min(1, Math.max(.3, Math.sqrt(L / (80 * DPR))));
    const P = Math.min(.55 * L, Math.max(4 * W, .35 * L));
    const R = pts.map((p, i) => {
      const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(m - 1, i + 1)], t = norm(q1[0] - q0[0], q1[1] - q0[1]);
      const a = s[i], b = L - s[i];
      let f = .6 + .4 * Math.abs(Math.sin(Math.atan2(t[1], t[0]) - Math.PI / 4));      // 45°に寝かせた筆：向きで太さが変わる
      f *= startT === 'press' ? (.8 + .2 * Math.min(1, a / W)) * (1 + .45 * Math.exp(-a / (1.3 * W)))   // 起筆の打ち込み
                              : Math.pow(Math.min(1, .2 + a / (3 * W)), .8);                            // 入り
      if (endT === 'harai') f *= Math.pow(Math.min(1, b / P), .85);                     // 払い：細く抜く
      else if (endT === 'tome') f *= 1 + .3 * Math.exp(-b / (1.2 * W));                 // 留め：押さえて止める
      else f *= 1 + .18 * Math.exp(-b / (2 * W));                                       // 跳ねの溜め
      return { x: p[0], y: p[1], d: p[2], w: W * f, s: a, cx: p[0], cy: p[1] };
    });
    if (endT === 'hane') {                      // 跳ね：次の画の方向へ素早く抜く
      const E = R[m - 1], hd = norm(nextDir[0] * .65 - tEnd[0] * .35, nextDir[1] * .65 - tEnd[1] * .35), Lh = 3.2 * W;
      let x = E.x, y = E.y, dir = tEnd;
      for (let k = 1; k <= 7; k++) { const u = k / 7, mix = Math.min(1, u * 2.4);
        dir = norm(tEnd[0] * (1 - mix) + hd[0] * mix, tEnd[1] * (1 - mix) + hd[1] * mix);
        x += dir[0] * Lh / 7; y += dir[1] * Lh / 7;
        R.push({ x, y, d: E.d, w: E.w * Math.pow(1 - u, 1.2), s: E.s + Lh * u, cx: E.cx, cy: E.cy }); }
    }
    for (let i = 0; i + 1 < R.length; i++) {
      const A = R[i], B = R[i + 1];
      const ta = norm(R[Math.min(R.length - 1, i + 1)].x - R[Math.max(0, i - 1)].x, R[Math.min(R.length - 1, i + 1)].y - R[Math.max(0, i - 1)].y);
      const tb = norm(R[Math.min(R.length - 1, i + 2)].x - A.x, R[Math.min(R.length - 1, i + 2)].y - A.y);
      const ax = -ta[1] * A.w / 2, ay = ta[0] * A.w / 2, bx = -tb[1] * B.w / 2, by = tb[0] * B.w / 2;
      pushV(A.x + ax, A.y + ay, A.s, 1, A.cx, A.cy, A.d); pushV(A.x - ax, A.y - ay, A.s, -1, A.cx, A.cy, A.d); pushV(B.x + bx, B.y + by, B.s, 1, B.cx, B.cy, B.d);
      pushV(A.x - ax, A.y - ay, A.s, -1, A.cx, A.cy, A.d); pushV(B.x - bx, B.y - by, B.s, -1, B.cx, B.cy, B.d); pushV(B.x + bx, B.y + by, B.s, 1, B.cx, B.cy, B.d);
    }
    const cap = Q => { for (let k = 0; k < 10; k++) { const a0 = k / 10 * 6.2832, a1 = (k + 1) / 10 * 6.2832, r = Q.w / 2;
      pushV(Q.x, Q.y, Q.s, 0, Q.cx, Q.cy, Q.d); pushV(Q.x + Math.cos(a0) * r, Q.y + Math.sin(a0) * r, Q.s, 1, Q.cx, Q.cy, Q.d); pushV(Q.x + Math.cos(a1) * r, Q.y + Math.sin(a1) * r, Q.s, 1, Q.cx, Q.cy, Q.d); } };
    if (endT === 'tome') cap(R[m - 1]);
    if (startT === 'press') cap(R[0]);
  }
  let strokeSrc = [];
  /* [拡張] mesh.userData.nihongaDynamic = true のメッシュは、頂点位置（モーフ等で書き換えた position）を毎フレーム読み直して輪郭を取る */
  function refreshStroke(S) {
    const P = S.mesh.geometry.attributes.position.array, { wid, cnt, wp } = S;
    wp.fill(0);
    for (let v = 0; v < wid.length; v++) { const i = wid[v]; wp[3 * i] += P[3 * v]; wp[3 * i + 1] += P[3 * v + 1]; wp[3 * i + 2] += P[3 * v + 2]; }
    for (let i = 0; i < cnt.length; i++) { const c = cnt[i]; wp[3 * i] /= c; wp[3 * i + 1] /= c; wp[3 * i + 2] /= c; }
  }
  function buildStrokes() {
    nv = 0; camera.updateMatrixWorld();
    for (const S of strokeSrc) {
      if (S.mesh.userData.nihongaDynamic) refreshStroke(S);
      const camL = S.mesh.worldToLocal(camera.position.clone());
      const chains = contourChains(S, camL);
      for (const c of chains) strokesFromChain(c.pts.map(p => project(S.mesh, p)), c.closed);
    }
    for (const k of ['position', 'aS', 'aC']) sGeo.attributes[k].needsUpdate = true;
    sGeo.setDrawRange(0, nv);
  }

  const compMat = new T.ShaderMaterial({
    uniforms: { tCol: { value: null }, tInf: { value: null }, uRes: { value: new T.Vector2() }, uPx: { value: DPR } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: COMP, depthTest: false, depthWrite: false });
  const quadScene = new T.Scene(), quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quadScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), compMat));

  let rtCol, rtInf;
  function setSize() {
    const s = renderer.getDrawingBufferSize(new T.Vector2());
    rtCol?.dispose(); rtInf?.dispose();
    rtCol = new T.WebGLRenderTarget(s.x, s.y, { samples: 4 });
    rtInf = new T.WebGLRenderTarget(s.x, s.y, { type: T.HalfFloatType, minFilter: T.NearestFilter, magFilter: T.NearestFilter });
    compMat.uniforms.tCol.value = rtCol.texture; compMat.uniforms.tInf.value = rtInf.texture; compMat.uniforms.uRes.value.copy(s);
    sMat.uniforms.tInf.value = rtInf.texture; sMat.uniforms.uRes.value.copy(s); BW = s.x; BH = s.y; W0 = params.lineWidth * DPR;
  }

  const meshes = [];
  let nextId = 1;
  /* モデルを登録：メッシュごとに彩色用・情報用の材質を作る。
     mesh.userData.nihongaGroup が同じ部位は、境目に線を引かない（例：胴と尾鰭） */
  function add(root) {
    root.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(root), wsize = box.getSize(new T.Vector3()).length() || 1;
    const groups = new Map();
    root.traverse(m => {
      if (!m.isMesh || m.userData.nihonga) return;
      const om = Array.isArray(m.material) ? m.material[0] : m.material;
      let map = om.map;
      if (map) { map = map.clone(); map.colorSpace = T.NoColorSpace; map.needsUpdate = true; }
      else { const c = (om.color ?? new T.Color(1, 1, 1)).clone().convertLinearToSRGB();
        map = new T.DataTexture(new Uint8Array([c.r * 255, c.g * 255, c.b * 255, 255]), 1, 1); map.needsUpdate = true; }
      const ws = new T.Vector3(); m.getWorldScale(ws);
      const objScale = { value: 1 / (wsize / ws.x) };            // モデル全体の大きさ≒1になる係数
      const g = m.userData.nihongaGroup;
      let id;
      if (g != null && groups.has(g)) id = groups.get(g);
      else { id = nextId; nextId = Math.min(nextId + 1, 15); if (g != null) groups.set(g, id); }
      const side = om.side ?? T.FrontSide;
      m.userData.nihonga = {
        orig: m.material,
        paint: new T.ShaderMaterial({ uniforms: { map: { value: map }, uObjScale: objScale, ...U }, vertexShader: VERT, fragmentShader: PAINT, side }),
        info: new T.ShaderMaterial({ uniforms: { uId: { value: id }, uObjScale: objScale }, vertexShader: VERT, fragmentShader: INFO, side }),
        stroke: prepStroke(m) };
      meshes.push(m); strokeSrc.push(m.userData.nihonga.stroke);
    });
  }
  function remove(root) {
    root.traverse(m => { const n = m.userData?.nihonga; if (!n) return;
      m.material = n.orig; n.paint.dispose(); n.info.dispose();
      meshes.splice(meshes.indexOf(m), 1); strokeSrc.splice(strokeSrc.indexOf(n.stroke), 1); delete m.userData.nihonga; });
  }
  const use = k => meshes.forEach(m => m.material = m.userData.nihonga[k]);

  /* 描画：renderer.render(scene, camera) の代わりに呼ぶ */
  function render(scene, cam) {
    camera = cam;
    if (!rtCol) setSize();
    W0 = params.lineWidth * DPR; U.uBrush.value = params.brush; U.uBands.value = params.bands;
    const ac = renderer.autoClear; renderer.autoClear = false;
    use('paint'); renderer.setRenderTarget(rtCol); renderer.clear(); renderer.render(scene, cam);
    use('info'); renderer.setRenderTarget(rtInf); renderer.clear(); renderer.render(scene, cam);
    if (params.ink && strokeSrc.length) { buildStrokes(); renderer.setRenderTarget(rtCol); renderer.render(strokeScene, quadCam); }
    renderer.setRenderTarget(null); renderer.clear(); renderer.render(quadScene, quadCam);
    use('orig'); renderer.autoClear = ac;
  }
  function dispose() {
    remove({ traverse: f => meshes.slice().forEach(f) });
    rtCol?.dispose(); rtInf?.dispose(); sGeo.dispose(); sMat.dispose(); compMat.dispose();
  }

  /* 実行中に変更できる設定 */
  const params = { lineWidth: opts.lineWidth ?? 12, ink: opts.ink ?? true, brush: opts.brush ?? 1, bands: opts.bands ?? 3 };
  return { add, remove, render, setSize, dispose, params };
}
