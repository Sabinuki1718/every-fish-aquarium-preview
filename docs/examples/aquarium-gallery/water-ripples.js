(() => {
  const canvas = document.querySelector('.water-ripples');
  const context = canvas?.getContext('2d');
  if (!context) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let pixels;
  let visible = true;
  let animation = 0;
  let lastFrame = -Infinity;

  function paint(time) {
    const { width, height, data } = pixels;
    const coordinateStep = .002 * canvas.clientWidth / (2 * width);
    const depthStep = .002 * canvas.clientHeight / (2 * height);
    for (let y = 0; y < height; y++) {
      const z = y * depthStep;
      const bend = Math.sin(z * 137 + time * .7);
      for (let x = 0; x < width; x++) {
        const u = x * coordinateStep;
        const drift = Math.sin(u * 23 + z * 17 - time * .34);
        const phase = (u - z * .36) * 175 + bend * (1.2 + drift * .7)
          + 2.8 * Math.sin(u * 13 - z * 29 + time * .25);
        // Keep the narrow crest from the Lake Biwa water shader.
        const crest = Math.pow(Math.max(0, Math.sin(phase)), 28);
        const slope = Math.max(0, Math.sin(phase - .58));
        const crossWave = .48 + .52 * Math.sin(u * 19 - z * 36 + time * .55) ** 2;
        const shade = slope ** 3 * crossWave ** 2 * .19;
        const lift = crest * .43;
        const offset = (y * width + x) * 4;
        const alpha = shade + lift * (1 - shade);
        const blueRatio = alpha > 0 ? shade / alpha : 0;
        data[offset] = 255 - 199 * blueRatio;
        data[offset + 1] = 255 - 94 * blueRatio;
        data[offset + 2] = 255 - 36 * blueRatio;
        data[offset + 3] = Math.round(alpha * 255);
      }
    }
    context.putImageData(pixels, 0, 0);
  }

  function resize() {
    const width = Math.max(1, Math.min(420, Math.ceil(canvas.clientWidth / 2)));
    const height = Math.max(1, Math.min(360, Math.ceil(canvas.clientHeight / 3)));
    canvas.width = width;
    canvas.height = height;
    pixels = context.createImageData(width, height);
    paint(reducedMotion.matches ? 0 : performance.now() / 1000);
  }

  function tick(now) {
    animation = requestAnimationFrame(tick);
    if (now - lastFrame < 1000 / 18) return;
    lastFrame = now;
    paint(now / 1000);
  }

  function sync() {
    cancelAnimationFrame(animation);
    if (reducedMotion.matches) paint(0);
    else if (visible && !document.hidden) animation = requestAnimationFrame(tick);
  }

  resize();
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  }).observe(canvas);
  reducedMotion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
})();
