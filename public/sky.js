// The hero sky. Two Muse lights trade messages along braided threads; the sky responds to the
// visitor: stars drift in depth with the pointer, the lights lean toward it, messages flare on
// arrival, and a click or tap sends one more. The plan note keeps finding new plans.
// Reduced motion: one still frame. Pauses when off screen or in a hidden tab.
(() => {
  const canvas = document.querySelector(".sky");
  if (!canvas || !canvas.getContext) return;
  const hero = canvas.parentElement;
  const note = hero.querySelector(".plan-note");
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const GOLD = [255, 210, 122];
  const LILAC = [184, 164, 255];
  const WHITE_GOLD = [255, 248, 235];
  const WHITE_LILAC = [245, 240, 255];
  const PLANS = [
    ["Thursday, 7:00 pm", "Olive, with Alex and Sam"],
    ["Saturday, 10:00 am", "Farmers market, with Mom"],
    ["Sunday, 2:00 pm", "Hike at Chautauqua, with Jo"],
    ["Friday, 6:30 pm", "Movie night at Priya's"]
  ];

  let w = 0, h = 0, dpr = 1, stars = [], running = false, raf = 0;
  let start = performance.now(), last = start;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const extra = []; // messages sent by clicks: { t0, dir }
  const flares = []; // arrival rings: { who, t0, color }
  const meteors = []; // shooting stars
  let nextMeteor = 4 + Math.random() * 4;
  let lastPhase = -1;
  let planIndex = 0, planShown = false, nextPlanAt = 0;

  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, a).toFixed(3)})`;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const now = () => (performance.now() - start) / 1000;

  function layout() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed = 7;
    stars = Array.from({ length: Math.round((w * h) / 4600) }, () => ({
      x: rand() * w, y: rand() * h * 0.8, r: rand() * 1.1 + 0.25, tw: rand() * Math.PI * 2, s: 0.4 + rand() * 1.2, d: 0.15 + rand() * 0.85
    }));
  }

  function anchors() {
    const wide = w > 820;
    const high = canvas.dataset.position === "high";
    const cx = wide ? w * (high ? 0.62 : 0.7) : w * 0.5;
    const cy = wide && !high ? h * 0.33 : wide ? h * 0.2 : h * 0.18;
    const span = wide ? Math.min(w * 0.17, 230) : Math.min(w * 0.3, 150);
    return { cx, cy, span };
  }

  function curve(A, B, cx, cy, span, upper, phase) {
    const lift = span * (0.62 + 0.08 * Math.sin(phase + (upper ? 0 : 2)));
    const dir = upper ? -1 : 1;
    return { p0: A, p1: [cx - span * 0.35, cy + dir * lift], p2: [cx + span * 0.35, cy - dir * lift * 0.55], p3: B };
  }

  const bez = (c, t) => {
    const u = 1 - t;
    return [0, 1].map((i) => u * u * u * c.p0[i] + 3 * u * u * t * c.p1[i] + 3 * u * t * t * c.p2[i] + t * t * t * c.p3[i]);
  };

  function stroke(c, alpha) {
    const g = ctx.createLinearGradient(c.p0[0], c.p0[1], c.p3[0], c.p3[1]);
    g.addColorStop(0, rgba(GOLD, alpha));
    g.addColorStop(1, rgba(LILAC, alpha));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(c.p0[0], c.p0[1]);
    ctx.bezierCurveTo(c.p1[0], c.p1[1], c.p2[0], c.p2[1], c.p3[0], c.p3[1]);
    ctx.save();
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.18;
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function glow(x, y, r, color, a) {
    if (a <= 0 || r <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, a));
    g.addColorStop(0.35, rgba(color, a * 0.35));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function setPlan(i) {
    const [when, what] = PLANS[i % PLANS.length];
    const strong = document.createElement("strong");
    strong.textContent = when;
    note.replaceChildren(strong, what);
  }

  function frame(stamp) {
    const t = (stamp - start) / 1000;
    const dt = Math.min(0.05, (stamp - last) / 1000);
    last = stamp;
    ctx.clearRect(0, 0, w, h);

    // Ease the pointer so everything drifts rather than snaps.
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);

    for (const s of stars) {
      ctx.fillStyle = rgba([236, 232, 255], 0.32 + 0.35 * Math.sin(s.tw + t * s.s));
      ctx.beginPath();
      ctx.arc(s.x - pointer.x * 14 * s.d, s.y - pointer.y * 9 * s.d, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!reduce && t > nextMeteor) {
      nextMeteor = t + 7 + Math.random() * 7;
      const fromLeft = Math.random() < 0.5;
      meteors.push({
        x: fromLeft ? w * (0.05 + Math.random() * 0.4) : w * (0.55 + Math.random() * 0.4),
        y: h * (0.04 + Math.random() * 0.2),
        vx: (fromLeft ? 1 : -1) * (520 + Math.random() * 220), vy: 180 + Math.random() * 120, t0: t, life: 0.9
      });
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      const age = t - m.t0;
      if (age > m.life) { meteors.splice(i, 1); continue; }
      const x = m.x + m.vx * age, y = m.y + m.vy * age;
      const fade = Math.sin((age / m.life) * Math.PI);
      const g = ctx.createLinearGradient(x, y, x - m.vx * 0.16, y - m.vy * 0.16);
      g.addColorStop(0, rgba(WHITE_GOLD, 0.9 * fade));
      g.addColorStop(1, rgba(WHITE_GOLD, 0));
      ctx.strokeStyle = g; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - m.vx * 0.16, y - m.vy * 0.16); ctx.stroke();
    }

    const { cx, cy, span } = anchors();
    const bob = (k) => Math.sin(t * 0.9 + k) * span * 0.04;
    const lean = [pointer.x * 22, pointer.y * 14];
    const A = [cx - span + lean[0] * 0.8, cy + bob(0) + lean[1] * 0.8];
    const B = [cx + span + lean[0], cy + bob(1.7) + lean[1]];
    const intro = reduce ? 1 : Math.min(1, t / 1.5);
    const upper = curve(A, B, cx + lean[0], cy + lean[1], span, true, t * 0.5);
    const lower = curve(A, B, cx + lean[0], cy + lean[1], span, false, t * 0.5);
    stroke(upper, 0.45 * intro);
    stroke(lower, 0.35 * intro);

    const period = 2.6;
    for (let i = 0; i < 3; i++) {
      const offset = i * (period / 3);
      if (t < 1 + offset) continue;
      const p = ((t - 1 + offset) % period) / period;
      const out = bez(upper, p);
      glow(out[0], out[1], 18, GOLD, 0.95 * Math.sin(Math.PI * p));
      const q = (p + 0.5) % 1;
      const back = bez(lower, 1 - q);
      glow(back[0], back[1], 18, LILAC, 0.9 * Math.sin(Math.PI * q));
      if (i === 0 && !reduce) {
        if (lastPhase > 0.9 && p < 0.1) flares.push({ who: "B", t0: t, color: GOLD });
        if (lastPhase >= 0 && lastPhase < 0.5 && p >= 0.5) flares.push({ who: "A", t0: t, color: LILAC });
        lastPhase = p;
      }
    }

    for (let i = extra.length - 1; i >= 0; i--) {
      const m = extra[i];
      const p = (t - m.t0) / 1.1;
      if (p < 0) continue;
      if (p >= 1) { flares.push({ who: m.dir > 0 ? "B" : "A", t0: t, color: m.dir > 0 ? GOLD : LILAC }); extra.splice(i, 1); continue; }
      const eased = 1 - Math.pow(1 - p, 2);
      const pos = m.dir > 0 ? bez(upper, eased) : bez(lower, 1 - eased);
      glow(pos[0], pos[1], 26, m.dir > 0 ? GOLD : LILAC, 1);
      glow(pos[0], pos[1], 6, m.dir > 0 ? WHITE_GOLD : WHITE_LILAC, 1);
    }

    for (let i = flares.length - 1; i >= 0; i--) {
      const f = flares[i];
      const age = (t - f.t0) / 0.9;
      if (age >= 1) { flares.splice(i, 1); continue; }
      const at = f.who === "A" ? A : B;
      ctx.strokeStyle = rgba(f.color, 0.55 * (1 - age));
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(at[0], at[1], 10 + age * span * 0.35, 0, Math.PI * 2); ctx.stroke();
      glow(at[0], at[1], span * 0.3, f.color, 0.35 * (1 - age));
    }

    const pulse = 1 + 0.05 * Math.sin(t * 1.6);
    glow(A[0], A[1], span * 0.75 * pulse, GOLD, 0.5);
    glow(B[0], B[1], span * 0.75 * pulse, LILAC, 0.45);
    glow(A[0], A[1], span * 0.16, GOLD, 0.9);
    glow(B[0], B[1], span * 0.16, LILAC, 0.9);
    glow(A[0], A[1], 11, WHITE_GOLD, 1);
    glow(B[0], B[1], 11, WHITE_LILAC, 1);

    if (note) {
      note.style.setProperty("--note-x", `${((A[0] + B[0]) / 2 / w) * 100}%`);
      note.style.setProperty("--note-y", `${((Math.min(A[1], B[1]) - span * 0.55) / h) * 100}%`);
      if (!planShown && (t > 4.2 || reduce)) {
        planShown = true;
        nextPlanAt = t + 7;
        note.classList.add("is-shown");
      } else if (planShown && !reduce && t > nextPlanAt) {
        // The Muses find another plan: fade out, swap, land with a flare on both lights.
        nextPlanAt = t + 7;
        note.classList.remove("is-shown");
        setTimeout(() => {
          setPlan(++planIndex);
          note.classList.add("is-shown");
          flares.push({ who: "A", t0: now(), color: GOLD }, { who: "B", t0: now(), color: LILAC });
        }, 700);
      }
    }

    if (running && !reduce) raf = requestAnimationFrame(frame);
  }

  function play() {
    if (running || reduce) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    cancelAnimationFrame(raf);
  }

  layout();
  if (reduce) {
    frame(performance.now());
  } else {
    new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? play() : pause())).observe(canvas);
    document.addEventListener("visibilitychange", () => (document.hidden ? pause() : play()));
    hero.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const r = hero.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
    });
    hero.addEventListener("pointerleave", () => { pointer.tx = 0; pointer.ty = 0; });
    // Clicking the sky (not a link or button) sends a message and gets a reply.
    hero.addEventListener("click", (e) => {
      if (e.target.closest("a, button, input, textarea") || extra.length > 4) return;
      const t = now();
      extra.push({ t0: t, dir: 1 }, { t0: t + 0.55, dir: -1 });
    });
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
