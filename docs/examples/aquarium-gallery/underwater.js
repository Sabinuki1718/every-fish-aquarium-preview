// Underwater backdrop for the gallery: a WebGL water column (light shafts, surface shimmer,
// drifting marine snow) that darkens as the page scrolls deeper, plus bubbles that rise
// with the scroll. Falls back to the CSS gradient when WebGL is unavailable.
(() => {
  const glCanvas = document.querySelector('.water-gl');
  const bubbleCanvas = document.querySelector('.water-bubbles');
  if (!glCanvas || !bubbleCanvas) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)').matches;
  const GL_SCALE = coarse ? .4 : .5;          // the water is soft, so render it small and let CSS stretch it
  const MAX_BUBBLES = coarse ? 90 : 160;

  let scrollY = window.scrollY;
  let depth = 0;

  function measureDepth() {
    const range = document.documentElement.scrollHeight - innerHeight;
    depth = range > 0 ? Math.min(1, Math.max(0, scrollY / range)) : 0;
  }

  // ------------------------------------------------------------------ water (WebGL)
  const gl = glCanvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  let drawWater = () => {};
  if (gl) {
    const vs = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
    const fs = `precision mediump float;
uniform vec2 uRes; uniform float uTime; uniform float uDepth; uniform float uScroll;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a*noise(p); p = p*2.03 + 17.1; a *= .5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;                 // y = 1 is the top of the screen
  float asp = uRes.x / uRes.y;
  vec2 p = vec2((uv.x - .5) * asp, uv.y);
  float d = uDepth, t = uTime;

  // water column: bright teal near the surface, deep navy below; the whole column darkens with depth
  vec3 top = mix(vec3(.30, .72, .88), vec3(.05, .26, .43), d);
  vec3 bot = mix(vec3(.04, .33, .52), vec3(.01, .06, .14), d);
  vec3 col = mix(bot, top, pow(uv.y, 1.25));

  // underside of the surface: a moving bright band of refracted sky at the top
  float w = fbm(vec2(p.x*3.5 + t*.12, t*.18)) * .6 + fbm(vec2(p.x*9. - t*.22, 4. + t*.13)) * .4;
  float surf = smoothstep(.80, 1.02, uv.y + (w - .5) * .14);
  float glint = pow(fbm(vec2(p.x*14. + t*.4, uv.y*6. - t*.3)), 3.) * surf;
  col += vec3(.65, .92, 1.) * (surf*.30 + glint*.9) * (1. - d);

  // light shafts fanning down from above the surface, slowly swaying and flickering
  vec2 src = vec2(.25*asp*sin(t*.04), 1.7);
  vec2 dir = p - src;
  float ang = atan(dir.x, -dir.y);
  float rays = pow(.5 + .5*sin(ang*21. + t*.35 + sin(ang*6. - t*.25)*1.6), 6.)
             + .7*pow(.5 + .5*sin(ang*37. - t*.5 + 1.3), 8.)
             + .45*pow(.5 + .5*sin(ang*63. + t*.65 + 2.1), 10.);
  rays *= .4 + 1.2*fbm(vec2(ang*10., t*.12));
  float fall = smoothstep(-.15, 1., uv.y);
  col += vec3(.55, .86, 1.) * rays * fall * fall * .20 * (1. - d*.8);

  // drifting murk
  float haze = fbm(p*2.2 + vec2(t*.015, t*.01 - uScroll*.00045));
  col *= .86 + .28*haze;

  // marine snow in three depths; it sinks slowly and slides up past you as you scroll down
  for (int L = 0; L < 3; L++) {
    float fl = float(L), sc = 16. + fl*13.;
    vec2 q = p*sc + vec2(t*(.04 + fl*.02), t*(.10 + fl*.04) - uScroll*(.0016 + fl*.0012)*sc/16.);
    vec2 id = floor(q), f = fract(q) - .5;
    vec2 o = vec2(hash(id + 3.1), hash(id + 5.7)) - .5;
    float r = length(f - o*.7);
    float s = smoothstep(.07 + fl*.012, 0., r) * step(.80, hash(id + fl*7.3));
    col += vec3(.72, .88, .94) * s * (.14 + .10*fl) * (1. - d*.45);
  }

  vec2 vc = uv - vec2(.5, .55);
  col *= 1. - dot(vc, vc)*.6;
  gl_FragColor = vec4(col, 1.);
}`;
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const u = name => gl.getUniformLocation(prog, name);
      const uRes = u('uRes'), uTime = u('uTime'), uDepth = u('uDepth'), uScroll = u('uScroll');
      drawWater = time => {
        gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        gl.uniform2f(uRes, glCanvas.width, glCanvas.height);
        gl.uniform1f(uTime, time);
        gl.uniform1f(uDepth, depth);
        gl.uniform1f(uScroll, scrollY);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      document.documentElement.classList.add('has-water');
    }
  }

  // ------------------------------------------------------------------ bubbles (2D)
  const ctx = bubbleCanvas.getContext('2d');
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 128;
  (() => {
    const s = sprite.getContext('2d'), c = 64, r = 60;
    let g = s.createRadialGradient(c, c, r * .2, c, c, r);           // clear body, brighter rim
    g.addColorStop(0, 'rgba(210,240,255,0.03)');
    g.addColorStop(.72, 'rgba(210,240,255,0.08)');
    g.addColorStop(.93, 'rgba(235,250,255,0.42)');
    g.addColorStop(1, 'rgba(235,250,255,0)');
    s.fillStyle = g; s.beginPath(); s.arc(c, c, r, 0, Math.PI * 2); s.fill();
    s.strokeStyle = 'rgba(255,255,255,0.55)'; s.lineWidth = 2.2;     // thin edge
    s.beginPath(); s.arc(c, c, r - 3, 0, Math.PI * 2); s.stroke();
    g = s.createRadialGradient(c - 22, c - 24, 0, c - 22, c - 24, 22); // specular highlight
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    s.fillStyle = g; s.beginPath(); s.ellipse(c - 22, c - 24, 20, 14, -.6, 0, Math.PI * 2); s.fill();
    s.strokeStyle = 'rgba(255,255,255,0.35)'; s.lineWidth = 4;        // light caught on the lower side
    s.beginPath(); s.arc(c, c, r - 12, Math.PI * .2, Math.PI * .8); s.stroke();
  })();

  const bubbles = [];
  let W = 0, H = 0, dpr = 1;
  const sources = [.08, .27, .63, .91];                                // a few steady columns, like air stones
  function spawn(y, burst) {
    if (bubbles.length >= MAX_BUBBLES) return;
    const big = Math.random() < (burst ? .18 : .1);
    const r = big ? 7 + Math.random() * 11 : 1.5 + Math.random() * 5;
    const col = Math.random() < .55 ? sources[(Math.random() * sources.length) | 0] : Math.random();
    bubbles.push({
      x: (col + (Math.random() - .5) * .05) * W,
      y: y ?? H + r + Math.random() * 40,
      r,
      vy: 28 + r * 7 + Math.random() * 20,                             // bigger bubbles rise faster
      phase: Math.random() * Math.PI * 2,
      wob: .6 + Math.random() * 1.6,
      sway: (2 + r * .8) * (Math.random() < .5 ? -1 : 1),
      near: .55 + r / 22,                                              // parallax: big ones are closer
    });
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    bubbleCanvas.width = Math.round(W * dpr); bubbleCanvas.height = Math.round(H * dpr);
    glCanvas.width = Math.max(1, Math.round(W * GL_SCALE)); glCanvas.height = Math.max(1, Math.round(H * GL_SCALE));
    measureDepth();
    if (!bubbles.length) for (let i = 0; i < MAX_BUBBLES * .35; i++) spawn(Math.random() * H);
  }

  let pendingScroll = 0, boost = 0;
  addEventListener('scroll', () => {
    const y = window.scrollY;
    pendingScroll += y - scrollY;
    scrollY = y;
    measureDepth();
    if (reducedMotion.matches) frame(performance.now(), true);
  }, { passive: true });

  function updateBubbles(dt) {
    const shift = pendingScroll; pendingScroll = 0;
    if (shift > 0) {                                                   // scrolling down: a rush of bubbles from below
      boost = Math.min(boost + shift * .02, 4);
      const n = Math.min(14, Math.round(shift / 22));
      for (let i = 0; i < n; i++) spawn(H + Math.random() * 120, true);
    }
    boost *= Math.exp(-dt * 2.2);
    if (Math.random() < dt * 5) spawn();                               // steady trickle
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.phase += dt * b.wob * 4;
      b.y -= b.vy * dt * (1 + boost * .5) + shift * b.near;
      b.x += Math.sin(b.phase) * b.sway * dt;
      if (b.y < -b.r * 3 || b.y > H + 260) bubbles.splice(i, 1);
    }
  }

  function drawBubbles() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const fade = 1 - depth * .35;
    for (const b of bubbles) {
      const top = Math.min(1, Math.max(0, b.y / (H * .18)));         // shrink away as they reach the surface
      const wob = b.r > 6 ? Math.sin(b.phase * 1.7) * .12 : 0;        // big bubbles wobble and flatten
      const w = b.r * 2 * (1.08 + wob), h = b.r * 2 * (.92 - wob);
      ctx.globalAlpha = (.55 + Math.min(.4, b.r / 25)) * fade * (.4 + .6 * top);
      ctx.drawImage(sprite, b.x - w / 2, b.y - h / 2, w, h);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ loop
  let raf = 0, last = performance.now(), lastWater = -1e9, running = false;
  function frame(now, still) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!still) updateBubbles(dt);
    if (still || now - lastWater > 1000 / (coarse ? 24 : 30)) { drawWater(still ? 8 : now / 1000); lastWater = now; }
    drawBubbles();
  }
  function tick(now) { frame(now); raf = requestAnimationFrame(tick); }
  function sync() {
    cancelAnimationFrame(raf);
    running = !reducedMotion.matches && !document.hidden;
    if (running) { last = performance.now(); raf = requestAnimationFrame(tick); }
    else frame(performance.now(), true);
  }

  resize();
  addEventListener('resize', () => { resize(); if (!running) frame(performance.now(), true); });
  new ResizeObserver(measureDepth).observe(document.body);
  reducedMotion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
})();
