// The hero sky: two Muse lights trade messages along braided threads until a plan appears.
// One orchestrated moment. Static frame for reduced motion; pauses when off screen.
(() => {
  const canvas = document.querySelector(".sky");
  const note = document.querySelector(".plan-note");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const GOLD = [255, 210, 122];
  const LILAC = [184, 164, 255];

  let w = 0, h = 0, dpr = 1, stars = [], running = false, start = performance.now(), raf = 0;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  // Deterministic pseudo-random so the sky doesn't reshuffle on resize.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed = 7;
    const count = Math.round((w * h) / 5200);
    stars = Array.from({ length: count }, () => ({
      x: rand() * w, y: rand() * h * 0.78, r: rand() * 1.1 + 0.25, tw: rand() * Math.PI * 2, s: 0.4 + rand() * 1.2
    }));
  }

  // Positions: lights sit in the right half on wide screens, higher and centered on narrow ones.
  function anchors() {
    const wide = w > 820;
    const high = canvas.dataset.position === "high";
    const cx = wide ? w * (high ? 0.62 : 0.7) : w * 0.5;
    const cy = wide && !high ? h * 0.42 : wide ? h * 0.2 : h * 0.18;
    const span = wide ? Math.min(w * 0.17, 230) : Math.min(w * 0.3, 150);
    return { a: [cx - span, cy], b: [cx + span, cy], cx, cy, span };
  }

  // Two threads arc between the lights, one above, one below; they breathe slowly.
  function thread(t, upper, phase) {
    const { a, b, cx, cy, span } = anchors();
    const lift = span * (0.62 + 0.08 * Math.sin(phase + (upper ? 0 : 2)));
    const dir = upper ? -1 : 1;
    return {
      p0: a, p3: b,
      p1: [cx - span * 0.35, cy + dir * lift],
      p2: [cx + span * 0.35, cy - dir * lift * 0.55]
    };
  }

  const bez = (c, t) => {
    const u = 1 - t;
    return [0, 1].map((i) => u * u * u * c.p0[i] + 3 * u * u * t * c.p1[i] + 3 * u * t * t * c.p2[i] + t * t * t * c.p3[i]);
  };

  function drawThread(c, color, alpha) {
    const g = ctx.createLinearGradient(c.p0[0], c.p0[1], c.p3[0], c.p3[1]);
    g.addColorStop(0, rgba(GOLD, alpha));
    g.addColorStop(1, rgba(LILAC, alpha));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(c.p0[0], c.p0[1]);
    ctx.bezierCurveTo(c.p1[0], c.p1[1], c.p2[0], c.p2[1], c.p3[0], c.p3[1]);
    // A soft wide pass under a crisp thin one reads as light, not a line.
    ctx.save();
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.18;
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function glow(x, y, r, color, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, a));
    g.addColorStop(0.35, rgba(color, a * 0.35));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function frame(now) {
    const t = (now - start) / 1000;
    ctx.clearRect(0, 0, w, h);

    for (const s of stars) {
      const a = 0.35 + 0.35 * Math.sin(s.tw + t * s.s);
      ctx.fillStyle = `rgba(236,232,255,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }

    const { a, b, span } = anchors();
    const bob = (k) => Math.sin(t * 0.9 + k) * span * 0.04;
    const A = [a[0], a[1] + bob(0)];
    const B = [b[0], b[1] + bob(1.7)];
    // Threads fade in over the first second and a half.
    const intro = Math.min(1, t / 1.5);
    const upper = thread(t, true, t * 0.5);
    const lower = thread(t, false, t * 0.5);
    upper.p0 = lower.p0 = A; upper.p3 = lower.p3 = B;
    drawThread(upper, GOLD, 0.45 * intro);
    drawThread(lower, LILAC, 0.35 * intro);

    // Messages: gold travels out on the upper thread, lilac answers on the lower one.
    const period = 2.6;
    for (let i = 0; i < 3; i++) {
      const p = ((t - 1 + i * (period / 3)) % period) / period;
      if (t < 1 + i * (period / 3)) continue;
      const out = bez(upper, p);
      glow(out[0], out[1], 18, GOLD, 0.95 * Math.sin(Math.PI * p));
      const back = bez(lower, 1 - ((p + 0.5) % 1));
      glow(back[0], back[1], 18, LILAC, 0.9 * Math.sin(Math.PI * ((p + 0.5) % 1)));
    }

    // The Muses themselves.
    const pulse = 1 + 0.05 * Math.sin(t * 1.6);
    glow(A[0], A[1], span * 0.75 * pulse, GOLD, 0.5);
    glow(B[0], B[1], span * 0.75 * pulse, LILAC, 0.45);
    glow(A[0], A[1], span * 0.16, GOLD, 0.9);
    glow(B[0], B[1], span * 0.16, LILAC, 0.9);
    glow(A[0], A[1], 11, [255, 248, 235], 1);
    glow(B[0], B[1], 11, [245, 240, 255], 1);

    if (note) {
      note.style.setProperty("--note-x", `${((A[0] + B[0]) / 2 / w) * 100}%`);
      note.style.setProperty("--note-y", `${((Math.min(A[1], B[1]) - span * 0.55) / h) * 100}%`);
      if (t > 4.2 || reduce) note.classList.add("is-shown");
    }

    if (running && !reduce) raf = requestAnimationFrame(frame);
  }

  function play() {
    if (running || reduce) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    cancelAnimationFrame(raf);
  }

  layout();
  if (reduce) {
    start = performance.now() - 6000;
    frame(performance.now());
  } else {
    new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? play() : pause())).observe(canvas);
    document.addEventListener("visibilitychange", () => (document.hidden ? pause() : play()));
  }
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      layout();
      if (!running) frame(performance.now());
    }, 120);
  });
})();
