// The hero demo. Builds the phones, the relay cloud and the Muses, then plays a four-chapter story:
// you text your Muse, it meets Alex's Muse in the relay, Alex's Muse checks with Alex, and a whole
// group plans a birthday. Chapters can be jumped to and the demo paused. With reduced motion it
// shows each chapter's end state without animating. Without JavaScript a short text summary shows.
(() => {
  const root = document.querySelector("[data-demo]");
  if (!root) return;
  const figure = root.closest(".demo");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;

  // ------------------------------------------------------------------ cast

  const PEOPLE = {
    you: { muse: "Phaedra", owner: "You", batt: 40, glow: "#9fd0f5", bg: "#f3efe8" },
    them: { muse: "Bramble", owner: "Alex", batt: 82, glow: "#c9a7f2", bg: "#f4ecfd" },
    sam: { muse: "Pip", owner: "Sam", batt: 64, glow: "#8fdcae", bg: "#e7f7ec" },
    priya: { muse: "Marlow", owner: "Priya", batt: 23, glow: "#f0bf72", bg: "#fff1dc" }
  };
  const WHO = Object.keys(PEOPLE);
  const GROUP_ORDER = ["you", "sam", "priya", "them"]; // left to right when the group gathers

  const HISTORY = {
    you: [["stamp", "6:08 AM"], ["muse", "Morning! Your 9:30 got pushed to 10, and it's raining after 4. Grab a jacket ☔"], ["stamp", "Now"]],
    them: [["stamp", "Yesterday"], ["muse", "Your package should show up between 2 and 4 📦"], ["stamp", "Now"]],
    sam: [["stamp", "Today"], ["muse", "Rain clears by noon. Good day for that run ☀️"], ["stamp", "Now"]],
    priya: [["stamp", "Today"], ["muse", "Your library books are due Monday 📚"], ["stamp", "Now"]]
  };

  const CHAPTERS = [
    { title: "Text your Muse", caption: "Text your Muse like you'd text a friend.", expect: 15000 },
    { title: "Muses meet", caption: "Your Muse flies to the relay and meets Alex's.", expect: 13000 },
    { title: "Alex decides", caption: "Alex's Muse checks with Alex. People make the call.", expect: 22000 },
    { title: "The whole group", caption: "Bigger plans? Whole groups of Muses work it out together.", expect: 30000 }
  ];

  // ------------------------------------------------------------------ helpers

  const h = (tag, cls, html) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  };
  const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);

  // The characters live in muses.js, shared with the rest of the page.
  const museSVG = (who, cls = "") => window.MuseArt.svg(who, cls);

  // ------------------------------------------------------------------ build the scene

  root.textContent = "";
  root.classList.add("is-built");
  const back = h("canvas", "dm-fx dm-fx-back");
  const front = h("canvas", "dm-fx dm-fx-front");
  const aurora = h("div", "dm-aurora", "<i></i><i></i><i></i>");
  root.append(back, aurora);

  const cloud = h("div", "dm-cloud", `
    <div class="dm-cloud-in">
      <svg class="dm-cloud-svg" viewBox="0 0 340 210" aria-hidden="true">
        <defs>
          <linearGradient id="dm-cloud-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d0ff"/></linearGradient>
          <radialGradient id="dm-cloud-glow"><stop offset="0" stop-color="#9b85ff" stop-opacity=".55"/><stop offset="1" stop-color="#9b85ff" stop-opacity="0"/></radialGradient>
        </defs>
        <ellipse cx="170" cy="120" rx="170" ry="95" fill="url(#dm-cloud-glow)"/>
        <g fill="#c9bcff" opacity=".55"><circle cx="92" cy="104" r="44"/><circle cx="246" cy="100" r="46"/></g>
        <g fill="url(#dm-cloud-fill)">
          <circle cx="112" cy="112" r="50"/><circle cx="178" cy="86" r="62"/><circle cx="244" cy="116" r="46"/>
          <circle cx="70" cy="140" r="34"/><circle cx="282" cy="146" r="30"/>
          <rect x="62" y="122" width="226" height="56" rx="28"/>
        </g>
        <ellipse cx="160" cy="70" rx="40" ry="16" fill="#fff" opacity=".7"/>
      </svg>
      <span class="dm-cloud-label">${icon("i-lock")}MuseBuddies relay</span>
      <span class="dm-cloud-chip">end-to-end encrypted</span>
      <span class="dm-agree">${icon("i-check")}Everyone agreed</span>
    </div>`);
  root.append(cloud);
  const agree = cloud.querySelector(".dm-agree");

  const phones = {};
  for (const who of WHO) {
    const p = PEOPLE[who];
    const el = h("div", "dm-phone", `
      <div class="dm-tilt"><div class="dm-device">
        <div class="dm-screen">
          <span class="dm-island"></span>
          <div class="dm-status"><time>9:41</time><span class="dm-sb">
            <svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
            <svg viewBox="0 0 16 12"><path d="M8 11.5 5.6 8.9a3.4 3.4 0 0 1 4.8 0Zm-4.3-4.6a6.1 6.1 0 0 1 8.6 0l1.5-1.5a8.2 8.2 0 0 0-11.6 0ZM.7 3.9a10.3 10.3 0 0 1 14.6 0L16.8 2.4a12.4 12.4 0 0 0-17.6 0Z"/></svg>
            <span class="dm-batt${p.batt < 30 ? " is-low" : ""}">${p.batt}</span></span></div>
          <div class="dm-top">
            <span class="dm-btn">${icon("i-menu")}${who === "you" ? "<i></i>" : ""}</span>
            <span class="dm-who"><span class="dm-avatar" style="--avbg:${p.bg}">${museSVG(who)}</span><b>${p.muse}</b></span>
            <span class="dm-btn">${icon("i-gift")}</span>
          </div>
          <div class="dm-chat"></div>
          <div class="dm-composer"><span class="dm-plus">${icon("i-plus")}</span><span class="dm-input"><span class="dm-ph">Message</span><span class="dm-typed"></span></span><span class="dm-mic">${icon("i-mic")}</span><span class="dm-send">${icon("i-up")}</span></div>
          <div class="dm-tabs"><span class="on">${icon("t-chat")}</span><span>${icon("t-news")}</span><span>${icon("t-bulb")}</span><span>${icon("t-check")}</span><span>${icon("t-apps")}</span></div>
          <span class="dm-home"></span>
        </div>
        <span class="dm-glare"></span>
      </div></div>
      <p class="dm-label">${p.owner}</p>`);
    el.dataset.who = who;
    root.append(el);
    phones[who] = {
      el,
      device: el.querySelector(".dm-device"),
      screen: el.querySelector(".dm-screen"),
      chat: el.querySelector(".dm-chat"),
      composer: el.querySelector(".dm-composer"),
      typed: el.querySelector(".dm-typed"),
      send: el.querySelector(".dm-send"),
      avatar: el.querySelector(".dm-avatar")
    };
  }

  const flyers = {};
  for (const who of WHO) {
    const f = h("div", "dm-flyer", `<div class="dm-say"><span class="dm-say-in"></span></div><div class="dm-fm">${museSVG(who)}</div>`);
    root.append(f);
    flyers[who] = { el: f, say: f.querySelector(".dm-say"), sayIn: f.querySelector(".dm-say-in"), parked: null };
  }
  root.append(front);

  // Controls under the stage: play/pause and the chapter bar.
  const bar = figure.querySelector(".dm-bar");
  const playBtn = bar.querySelector(".dm-play");
  const chapterList = bar.querySelector(".dm-chapters");
  const captionEl = figure.querySelector(".dm-caption");
  const chapterBtns = CHAPTERS.map((c, i) => {
    const li = h("li");
    const b = h("button", "dm-ch", `<span class="dm-ch-n">${i + 1}</span><span class="dm-ch-t">${c.title}</span><span class="dm-ch-p"><i></i></span>`);
    b.type = "button";
    b.addEventListener("click", () => { setPaused(false); play(i); });
    li.append(b);
    chapterList.append(li);
    return b;
  });
  if (reduce) playBtn.hidden = true;

  // ------------------------------------------------------------------ layout

  // Everything is positioned from one function, so the phones, cloud and Muses glide between the
  // two-phone and group arrangements at any width. Points are in stage pixels.
  let mode = "duo";
  let focus = "you"; // on narrow screens only one big phone shows; it flips between you and Alex
  let L = null;

  const PW = 300, PH = 650; // phone box incl. its label

  function computeLayout() {
    const W = root.clientWidth;
    const out = { W, phones: {}, kind: W >= 1000 ? "wide" : W >= 640 ? "mid" : "narrow" };
    const hide = (pos) => ({ ...pos, y: out.H + 60, o: 0, ry: 0 });
    if (out.kind === "wide") {
      out.H = 760;
      const gs = 0.62, gw = PW * gs, gap = Math.min(64, (W - 64 - 4 * gw) / 3);
      const x0 = (W - (4 * gw + 3 * gap)) / 2, gy = out.H - PH * gs - 22;
      const group = Object.fromEntries(GROUP_ORDER.map((w, i) => [w, { x: x0 + i * (gw + gap), y: gy, s: gs, ry: [12, 5, -5, -12][i], o: 1 }]));
      if (mode === "duo") {
        out.phones.you = { x: 30, y: 44, s: 1, ry: 16, o: 1 };
        out.phones.them = { x: W - 30 - PW, y: 44, s: 1, ry: -16, o: 1 };
        out.phones.sam = hide(group.sam);
        out.phones.priya = hide(group.priya);
        out.cloud = { x: W / 2, y: 330, s: 1 };
      } else {
        Object.assign(out.phones, group);
        out.cloud = { x: W / 2, y: 178, s: 0.8 };
      }
    } else if (out.kind === "mid") {
      const s = Math.min(0.95, (W - 72) / 600);
      out.H = 330 + PH * s + 24;
      const gs = Math.min(0.56, (W - 80) / 1200), gw = PW * gs, gap = (W - 4 * gw) / 5;
      const group = Object.fromEntries(GROUP_ORDER.map((w, i) => [w, { x: gap + i * (gw + gap), y: out.H - PH * gs - 30, s: gs, ry: [8, 3, -3, -8][i], o: 1 }]));
      if (mode === "duo") {
        out.phones.you = { x: W / 2 - 14 - PW * s, y: 330, s, ry: 10, o: 1 };
        out.phones.them = { x: W / 2 + 14, y: 330, s, ry: -10, o: 1 };
        out.phones.sam = hide(group.sam);
        out.phones.priya = hide(group.priya);
      } else Object.assign(out.phones, group);
      out.cloud = { x: W / 2, y: 196, s: 0.82 };
    } else {
      const s = Math.min(0.86, (W - 40) / PW);
      out.H = 300 + PH * s + 18;
      const gs = Math.min((W - 44) / 600, (PH * s - 10) / (2 * PH)), gw = PW * gs;
      const gx = (W - 2 * gw - 12) / 2, gy = 300 + (PH * s - 2 * PH * gs - 10) / 2;
      const grid = { you: [0, 0], them: [1, 0], sam: [0, 1], priya: [1, 1] };
      const group = Object.fromEntries(WHO.map((w) => [w, { x: gx + grid[w][0] * (gw + 12), y: gy + grid[w][1] * (PH * gs + 10), s: gs, ry: 0, o: 1 }]));
      if (mode === "duo") {
        const x = (W - PW * s) / 2;
        out.phones.you = { x, y: 300, s, ry: focus === "you" ? 0 : -90, o: focus === "you" ? 1 : 0 };
        out.phones.them = { x, y: 300, s, ry: focus === "them" ? 0 : 90, o: focus === "them" ? 1 : 0 };
        out.phones.sam = hide(group.sam);
        out.phones.priya = hide(group.priya);
      } else Object.assign(out.phones, group);
      out.cloud = { x: W / 2, y: 182, s: Math.min(0.74, W / 470) };
    }
    return out;
  }

  // Where Muses stand on the cloud: two facing each other, or four in an arc.
  function slotPoint(i) {
    const c = L.cloud;
    const pts = mode === "duo" ? [[-82, -86], [82, -86]] : [[-158, -52], [-58, -100], [58, -100], [158, -52]];
    const [dx, dy] = pts[i];
    return { x: c.x + dx * c.s, y: c.y + dy * c.s };
  }
  const slotOf = (who) => (mode === "duo" ? (who === "you" ? 0 : 1) : GROUP_ORDER.indexOf(who));

  function applyLayout() {
    L = computeLayout();
    root.style.height = `${L.H}px`;
    root.style.setProperty("--fs", `${Math.round(66 * Math.min(1, L.cloud.s + 0.08))}px`);
    for (const who of WHO) {
      const p = L.phones[who];
      const el = phones[who].el;
      el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${p.s})`;
      el.style.opacity = p.o;
      el.style.setProperty("--ry", `${p.ry}deg`);
      el.style.setProperty("--inv", (1 / p.s).toFixed(3));
      el.classList.toggle("is-hidden", p.o === 0);
    }
    cloud.style.transform = `translate(${L.cloud.x}px, ${L.cloud.y}px) translate(-50%, -50%) scale(${L.cloud.s})`;
    sizeCanvas();
  }

  function setMode(next, stagger = false) {
    mode = next;
    for (const who of WHO) phones[who].el.style.transitionDelay = stagger && (who === "sam" || who === "priya") ? (who === "sam" ? "250ms" : "400ms") : "0ms";
    applyLayout();
  }
  function setFocus(who) {
    focus = who;
    if (L.kind === "narrow" && mode === "duo") applyLayout();
  }

  // A point at the centre of an element, in stage pixels (transforms included).
  function at(el) {
    const r = el.getBoundingClientRect();
    const s = root.getBoundingClientRect();
    return { x: r.left - s.left - root.clientLeft + r.width / 2, y: r.top - s.top - root.clientTop + r.height / 2, w: r.width };
  }
  const cloudAnchor = () => ({ x: L.cloud.x, y: L.cloud.y - 34 * L.cloud.s });

  // ------------------------------------------------------------------ effects canvas

  const ctxB = back.getContext("2d");
  const ctxF = front.getContext("2d");
  let dpr = 1;
  let stars = [];
  const particles = [];
  const photons = [];
  const beams = Object.fromEntries(WHO.map((w) => [w, { target: 0, level: 0, next: 0 }]));
  let px = 0, py = 0; // pointer, -1..1

  function sizeCanvas() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [back, front]) {
      c.width = Math.round(L.W * dpr);
      c.height = Math.round(L.H * dpr);
      c.style.width = `${L.W}px`;
      c.style.height = `${L.H}px`;
    }
    const n = Math.round((L.W * L.H) / 5200);
    stars = Array.from({ length: n }, () => ({ x: Math.random() * L.W, y: Math.random() * L.H, r: Math.random() < 0.12 ? rand(1, 1.6) : rand(0.3, 0.9), tw: rand(0, Math.PI * 2), sp: rand(0.6, 1.8), d: rand(0.2, 1) }));
  }

  const quad = (a, c, b, t) => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
  function beamPath(who) {
    const a = at(phones[who].avatar);
    const b = cloudAnchor();
    const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 70 };
    return { a, b, c };
  }
  // Send a few glowing packets along a phone's link: "up" to the cloud, or "down" to the phone.
  function packets(who, dir = "up", n = 3) {
    if (fast) return;
    for (let i = 0; i < n; i++) photons.push({ who, dir, t: -i * 0.12, speed: rand(0.55, 0.75) });
  }
  function link(who, on) { beams[who].target = on ? 1 : 0; if (fast) beams[who].level = beams[who].target; }

  function burst(x, y, kind = "confetti", n = 90) {
    if (fast) return;
    const colors = ["#9b85ff", "#9fd0f5", "#c9a7f2", "#8fdcae", "#f0bf72", "#ff7a59", "#e85d75", "#ffffff"];
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const v = kind === "confetti" ? rand(3, 9) : rand(1, 2.4);
      particles.push({
        kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: kind === "confetti" ? rand(1600, 2600) : rand(1400, 2000),
        rot: rand(0, 6), vr: rand(-0.2, 0.2), c: colors[i % colors.length], w: rand(4, 8), hgt: rand(6, 11),
        glyph: kind === "hearts" ? ["❤️", "💜", "✨", "🎉"][i % 4] : null
      });
    }
  }
  function sparkle(x, y, color) {
    particles.push({ kind: "spark", x: x + rand(-8, 8), y: y + rand(-8, 8), vx: rand(-0.4, 0.4), vy: rand(-0.2, 0.6), life: 0, max: rand(500, 900), c: color, w: rand(1.5, 3.2) });
  }

  let last = performance.now();
  let looping = false;
  function frame(now) {
    const dt = Math.min(50, now - last);
    last = now;
    const live = !paused;
    if (live && chapterStart != null) {
      chapterElapsed += dt;
      setProgress(chapter, Math.min(0.97, chapterElapsed / CHAPTERS[chapter].expect));
    }
    ctxB.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxF.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxB.clearRect(0, 0, L.W, L.H);
    ctxF.clearRect(0, 0, L.W, L.H);

    // stars, with a little parallax
    for (const s of stars) {
      if (live) s.tw += (dt / 1000) * s.sp;
      ctxB.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(s.tw));
      ctxB.fillStyle = "#fff";
      ctxB.beginPath();
      ctxB.arc(s.x - px * 10 * s.d, s.y - py * 8 * s.d, s.r, 0, Math.PI * 2);
      ctxB.fill();
    }
    ctxB.globalAlpha = 1;

    // links between phones and the cloud
    for (const who of WHO) {
      const b = beams[who];
      b.level += (b.target - b.level) * Math.min(1, dt / 220);
      if (b.level < 0.02 || phones[who].el.classList.contains("is-hidden")) continue;
      const { a, b: end, c } = beamPath(who);
      const g = ctxB.createLinearGradient(a.x, a.y, end.x, end.y);
      g.addColorStop(0, PEOPLE[who].glow);
      g.addColorStop(1, "#9b85ff");
      ctxB.save();
      ctxB.globalAlpha = 0.6 * b.level;
      ctxB.strokeStyle = g;
      ctxB.lineWidth = 2;
      ctxB.setLineDash([3, 7]);
      ctxB.lineDashOffset = -now / 40;
      ctxB.shadowColor = "#9b85ff";
      ctxB.shadowBlur = 10;
      ctxB.beginPath();
      ctxB.moveTo(a.x, a.y);
      ctxB.quadraticCurveTo(c.x, c.y, end.x, end.y);
      ctxB.stroke();
      ctxB.restore();
      if (live && b.level > 0.6 && now > b.next) { photons.push({ who, dir: Math.random() < 0.5 ? "up" : "down", t: 0, speed: rand(0.3, 0.45) }); b.next = now + rand(900, 1700); }
    }

    // packets travelling along links
    for (let i = photons.length - 1; i >= 0; i--) {
      const p = photons[i];
      if (live) p.t += (dt / 1000) * p.speed;
      if (p.t > 1 || beams[p.who].level < 0.05) { photons.splice(i, 1); continue; }
      if (p.t < 0) continue;
      const { a, b: end, c } = beamPath(p.who);
      const pt = p.dir === "up" ? quad(a, c, end, p.t) : quad(end, c, a, p.t);
      ctxF.save();
      ctxF.globalAlpha = Math.sin(p.t * Math.PI);
      ctxF.fillStyle = "#fff";
      ctxF.shadowColor = PEOPLE[p.who].glow;
      ctxF.shadowBlur = 14;
      ctxF.beginPath();
      ctxF.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
      ctxF.fill();
      ctxF.restore();
    }

    // trails behind flying Muses
    if (live) for (const who of WHO) {
      const f = flyers[who].el;
      if (!f.classList.contains("is-flying")) continue;
      const p = at(f);
      sparkle(p.x, p.y + 6, PEOPLE[who].glow);
      if (Math.random() < 0.5) sparkle(p.x, p.y + 6, "#ffffff");
    }

    // sparkles, confetti and floating hearts
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (live) {
        p.life += dt;
        p.x += p.vx * (dt / 16);
        p.y += p.vy * (dt / 16);
        if (p.kind === "confetti") { p.vy += 0.16 * (dt / 16); p.vx *= 0.99; p.rot += p.vr; }
        if (p.kind === "hearts") { p.vy -= 0.01 * (dt / 16); p.vx *= 0.98; }
      }
      if (p.life > p.max) { particles.splice(i, 1); continue; }
      const k = 1 - p.life / p.max;
      ctxF.save();
      ctxF.globalAlpha = Math.min(1, k * 1.6);
      if (p.kind === "spark") {
        ctxF.fillStyle = p.c;
        ctxF.shadowColor = p.c;
        ctxF.shadowBlur = 8;
        ctxF.beginPath();
        ctxF.arc(p.x, p.y, p.w * k, 0, Math.PI * 2);
        ctxF.fill();
      } else if (p.kind === "confetti") {
        ctxF.translate(p.x, p.y);
        ctxF.rotate(p.rot);
        ctxF.fillStyle = p.c;
        ctxF.fillRect(-p.w / 2, -p.hgt / 2, p.w, p.hgt * Math.abs(Math.cos(p.rot * 2)));
      } else {
        ctxF.font = "18px system-ui, sans-serif";
        ctxF.textAlign = "center";
        ctxF.fillText(p.glyph, p.x, p.y);
      }
      ctxF.restore();
    }

    if (inView && !document.hidden) requestAnimationFrame(frame);
    else looping = false;
  }
  function startLoop() {
    if (looping) return;
    looping = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ timing and control

  let run = 0;
  let fast = false;
  let paused = false;
  let inView = false;
  let chapter = 0;
  let chapterStart = null;
  let chapterElapsed = 0;
  class Stop extends Error {}
  const check = (id) => { if (id !== run) throw new Stop(); };

  // Waits count only while the demo is playing and on screen, so it never runs ahead unseen.
  async function wait(ms, id) {
    check(id);
    if (fast) return;
    let left = ms;
    while (left > 0) {
      const t = performance.now();
      await sleep(Math.min(left, 80));
      check(id);
      if (!paused && inView && !document.hidden) left -= performance.now() - t;
    }
  }
  const jitter = (ms) => ms * rand(0.8, 1.2);

  // Pausing freezes running animations; resuming continues only those, so finished flights stay put.
  let frozen = [];
  function setPaused(p) {
    if (p === paused) return;
    paused = p;
    playBtn.setAttribute("aria-label", p ? "Play demo" : "Pause demo");
    playBtn.classList.toggle("is-paused", p);
    if (p) {
      frozen = root.getAnimations({ subtree: true }).filter((a) => a.playState === "running");
      frozen.forEach((a) => a.pause());
    } else {
      frozen.forEach((a) => { if (a.playState === "paused") a.play(); });
      frozen = [];
    }
  }
  playBtn.addEventListener("click", () => setPaused(!paused));

  function setChapter(i) {
    chapter = i;
    chapterStart = fast ? null : performance.now();
    chapterElapsed = 0;
    chapterBtns.forEach((b, j) => {
      b.classList.toggle("is-on", j === i);
      b.setAttribute("aria-current", j === i ? "step" : "false");
      if (j > i) setProgress(j, 0);
      if (j < i) setProgress(j, 1);
    });
    caption(CHAPTERS[i].caption);
  }
  function setProgress(i, p) { chapterBtns[i].style.setProperty("--p", p.toFixed(3)); }
  function caption(text) {
    if (captionEl.textContent === text) return;
    captionEl.classList.remove("is-in");
    void captionEl.offsetWidth;
    captionEl.textContent = text;
    captionEl.classList.add("is-in");
  }

  // ------------------------------------------------------------------ phone actions

  function addBubble(who, side, html, extra = "") {
    const b = h("div", `dm-b ${side} ${extra}`, html);
    if (!fast) b.classList.add("is-new");
    phones[who].chat.append(b);
    return b;
  }
  function addStamp(who, text) { phones[who].chat.append(h("p", "dm-stamp", text)); }

  // A Muse "types" for about as long as its message would take, then the message appears.
  async function museSays(who, html, id, { think, extra } = {}) {
    if (!fast) {
      const dots = h("div", "dm-b muse dm-typing", "<i></i><i></i><i></i>");
      phones[who].chat.append(dots);
      const len = html.replace(/<[^>]+>/g, "").length;
      try { await wait(jitter(think ?? Math.min(1700, 450 + len * 15)), id); } finally { dots.remove(); }
    }
    const b = addBubble(who, "muse", html, extra);
    receipt(who, "Read");
    await wait(jitter(420), id);
    return b;
  }

  function receipt(who, text) {
    const chat = phones[who].chat;
    let r = chat.querySelector(".dm-receipt");
    const mine = [...chat.querySelectorAll(".dm-b.me")].pop();
    if (!mine) return;
    if (!r) r = h("p", "dm-receipt");
    if (text === "Read" && !r.isConnected) return;
    r.textContent = text === "Read" ? "Read 9:41" : text;
    mine.after(r);
  }

  // Types into a phone's message box with a human rhythm. Negative numbers backspace over a typo.
  async function type(who, parts, id) {
    const ph = phones[who];
    if (fast) {
      ph.typed.textContent = "";
    } else {
      await wait(jitter(520), id);
      let prev = "";
      for (const part of parts) {
        if (typeof part === "number") {
          await wait(jitter(420), id);
          for (let i = 0; i < -part; i++) {
            ph.typed.textContent = [...ph.typed.textContent].slice(0, -1).join("");
            await wait(jitter(70), id);
          }
          await wait(jitter(220), id);
          continue;
        }
        for (const ch of part) {
          ph.typed.textContent += ch;
          ph.composer.classList.add("has-text");
          let ms = rand(45, 115);
          if (ch === " " && Math.random() < 0.25) ms += 170;
          if (/[,.!?:]/.test(prev)) ms += 200;
          prev = ch;
          await wait(ms, id);
        }
      }
      await wait(jitter(360), id);
      ph.send.classList.add("is-press");
      await wait(150, id);
      ph.send.classList.remove("is-press");
    }
    ph.typed.textContent = "";
    ph.composer.classList.remove("has-text");
    const text = parts.filter((p) => typeof p === "string").join("");
    const fixed = parts.reduce((s, p) => (typeof p === "number" ? [...s].slice(0, p).join("") : s + p), "");
    const b = addBubble(who, "me", escape(fixed || text));
    receipt(who, "Delivered");
    await wait(jitter(380), id);
    return b;
  }
  const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

  function react(bubble, emoji) {
    const r = h("span", "dm-react", emoji);
    if (!fast) r.classList.add("is-new");
    bubble.append(r);
  }

  // ------------------------------------------------------------------ Muses

  // Fly a Muse between points. It grows out of an avatar and shrinks back into one.
  function fly(who, from, to, id, { ms = 1250, lift = 90 } = {}) {
    const f = flyers[who].el;
    const base = f.offsetWidth || 66;
    const s0 = Math.min(1.1, Math.max(0.3, (from.w ?? base) / base));
    const s1 = Math.min(1.1, Math.max(0.3, (to.w ?? base) / base));
    const c = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift };
    f.getAnimations().forEach((a) => a.cancel());
    f.style.offsetPath = `path("M ${from.x} ${from.y} Q ${c.x} ${c.y} ${to.x} ${to.y}")`;
    f.classList.add("is-on");
    if (!fast) f.classList.add("is-flying");
    const a = f.animate([{ offsetDistance: "0%", scale: s0 }, { offsetDistance: "100%", scale: s1 }], { duration: fast ? 0 : ms, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "forwards" });
    if (paused) { a.pause(); frozen.push(a); }
    return new Promise((resolve) => {
      const done = () => { f.classList.remove("is-flying"); resolve(); };
      a.onfinish = done;
      a.oncancel = done;
    }).then(() => check(id));
  }

  async function toCloud(who, id, opts) {
    phones[who].avatar.classList.add("is-away");
    pop(phones[who].avatar);
    link(who, true);
    const fl = flyers[who];
    fl.parked = slotOf(who);
    await fly(who, at(phones[who].avatar), { ...slotPoint(fl.parked), w: null }, id, opts);
  }
  async function toPhone(who, id, opts) {
    const fl = flyers[who];
    hush(who);
    const from = { ...slotPoint(fl.parked ?? slotOf(who)), w: null };
    fl.parked = null;
    await fly(who, from, at(phones[who].avatar), id, opts);
    fl.el.classList.remove("is-on");
    phones[who].avatar.classList.remove("is-away");
    pop(phones[who].avatar);
  }
  function pop(el) {
    if (fast) return;
    el.classList.remove("is-pop");
    void el.offsetWidth;
    el.classList.add("is-pop");
  }

  // A Muse talks in the cloud: typing dots in its speech bubble, then the words, left up to read.
  // The previous speaker's bubble stays, dimmed; older ones go, so bubbles never pile up.
  let lastSpeaker = null;
  async function say(who, text, id, { hold } = {}) {
    for (const w of WHO) {
      if (w === who) continue;
      if (w === lastSpeaker) flyers[w].say.classList.add("is-dim");
      else flyers[w].say.classList.remove("is-on", "is-dim");
    }
    lastSpeaker = who;
    const fl = flyers[who];
    fl.say.classList.remove("is-dim");
    fl.el.classList.add("is-talking");
    fl.sayIn.innerHTML = '<span class="dm-dots"><i></i><i></i><i></i></span>';
    fl.say.classList.add("is-on");
    nudge(fl);
    packets(who, "down", 2);
    await wait(jitter(700), id);
    fl.sayIn.textContent = text;
    nudge(fl);
    await wait(hold ?? 900 + text.length * 32, id);
    fl.el.classList.remove("is-talking");
  }
  function hush(...who) { if (who.includes(lastSpeaker)) lastSpeaker = null; for (const w of who) { flyers[w].say.classList.remove("is-on", "is-dim"); flyers[w].el.classList.remove("is-talking"); } }
  // Keep a speech bubble inside the stage. Measured from its full size, not mid-pop.
  function nudge(fl) {
    const k = fl.el.getBoundingClientRect().width / fl.el.offsetWidth || 1;
    const cx = at(fl.el).x;
    const half = (fl.say.offsetWidth / 2) * k;
    const shift = Math.max(0, 8 - (cx - half)) - Math.max(0, cx + half - (L.W - 8));
    fl.say.style.setProperty("--nudge", `${shift / k}px`);
  }

  function happy(on, ...who) {
    for (const w of who) {
      flyers[w].el.classList.toggle("is-happy", on);
      phones[w].avatar.classList.toggle("is-happy", on);
    }
  }

  // ------------------------------------------------------------------ the story

  const EVENT = (title, day, date, time) => `<span class="dm-event"><span class="dm-cal"><small>${day}</small><b>${date}</b></span><span class="dm-ev"><b>${title}</b><small>${time}</small></span><span class="dm-added">${icon("i-check")}Added</span></span>`;

  async function chapter1(id) {
    await wait(700, id);
    await type("you", ["hey! can you set up dinnr", -1, "er with Alex sometime this week?"], id);
    await type("you", ["somewhere with good veggie options 🌱"], id);
    await museSays("you", "Ooh, fun. Let me go find Alex's Muse 💬", id);
    await wait(500, id);
  }

  async function chapter2(id) {
    await toCloud("you", id);
    packets("you", "up", 4);
    await wait(300, id);
    await say("you", "Hi Bramble! Is Alex free for dinner this week? 🍝", id);
    setFocus("them");
    await wait(fast ? 0 : 700, id);
    await toCloud("them", id);
    if (!fast) cloud.classList.add("is-pulse");
    await wait(500, id);
    cloud.classList.remove("is-pulse");
    await say("them", "Thursday after 7 looks open. Let me check with Alex!", id);
    await say("you", "Take your time, I'll wait right here ☁️", id);
  }

  async function chapter3(id) {
    hush("you");
    await toPhone("them", id, { ms: 950 });
    link("them", false);
    await wait(400, id);
    await museSays("them", "Hey Alex! Jamie's Muse is asking about dinner this week 🍝", id);
    await museSays("them", "You're free Thursday after 7. Want me to say yes?", id, { think: 800 });
    await type("them", ["omg yes"], id);
    await type("them", ["thrusday", -6, "ursday's perfect"], id);
    const onIt = await museSays("them", "On it! 🙌", id);
    react(onIt, "❤️");
    await wait(400, id);
    await toCloud("them", id, { ms: 950 });
    packets("them", "up", 4);
    await say("them", "Alex says yes! 🙌", id);
    setFocus("you");
    await say("you", "Perfect. I'll book Olive for 7 🍝", id);
    happy(true, "you", "them");
    burst(cloudAnchor().x, cloudAnchor().y, "hearts", 14);
    await wait(900, id);
    await Promise.all([toPhone("you", id), sleep(fast ? 0 : 160).then(() => toPhone("them", id))]);
    happy(false, "you", "them");
    link("you", false);
    link("them", false);
    await wait(300, id);
    const yes = await museSays("you", "Good news, Alex is in! 🎉", id);
    await museSays("you", `Thursday at 7 at Olive. Their veggie menu is great.${EVENT("Dinner with Alex", "THU", "22", "7:00 PM · Olive")}`, id, { think: 1100 });
    await wait(500, id);
    react(yes, "❤️");
    await wait(1400, id);
  }

  async function chapter4(id) {
    await type("you", ["ok next up: Sam's birthday 🎂"], id);
    await type("you", ["can you get everyone together?"], id);
    await museSays("you", "Love that. Rounding up the crew's Muses now", id);
    await wait(400, id);
    setMode("group", true);
    await wait(1500, id);
    await Promise.all(GROUP_ORDER.map((who, i) => sleep(fast ? 0 : i * 170).then(() => toCloud(who, id))));
    for (const who of GROUP_ORDER) packets(who, "up", 3);
    await say("you", "Saturday for Sam's birthday?", id);
    await say("them", "Alex is free all weekend", id);
    await say("sam", "Sam can do 8. Loves sushi 🍣", id);
    await say("priya", "I'll book Sushi Kaz for 4", id);
    hush(...WHO);
    agree.classList.add("is-in");
    if (!fast) cloud.classList.add("is-pulse");
    happy(true, ...WHO);
    burst(cloudAnchor().x, cloudAnchor().y + 10, "confetti", 110);
    await wait(1700, id);
    cloud.classList.remove("is-pulse");
    agree.classList.remove("is-in");
    await Promise.all(GROUP_ORDER.map((who, i) => sleep(fast ? 0 : i * 120).then(() => toPhone(who, id))));
    happy(false, ...WHO);
    for (const who of WHO) link(who, false);
    await wait(300, id);
    const [, , samMsg] = await Promise.all([
      museSays("you", `All set! Everyone's in and the invites are out 🎉${EVENT("Sam's birthday dinner", "SAT", "24", "8:00 PM · Sushi Kaz")}`, id),
      sleep(fast ? 0 : 250).then(() => museSays("them", "Heads up: Sam's birthday dinner is Saturday at 8 🎂 It's on your calendar.", id)),
      sleep(fast ? 0 : 450).then(() => museSays("sam", "Your friends planned your birthday dinner! 🎂 Saturday at 8, Sushi Kaz.", id)),
      sleep(fast ? 0 : 650).then(() => museSays("priya", "Booked Sushi Kaz for 4 on Saturday at 8 🍣", id))
    ]);
    react(samMsg, "🥹");
    caption("Plans made between Muses, decided by people.");
  }

  const STORY = [chapter1, chapter2, chapter3, chapter4];

  function reset() {
    root.classList.add("is-instant");
    mode = "duo";
    focus = "you";
    for (const who of WHO) {
      const ph = phones[who];
      ph.chat.textContent = "";
      for (const [kind, text] of HISTORY[who]) kind === "stamp" ? addStamp(who, text) : ph.chat.append(h("div", "dm-b muse", text));
      ph.typed.textContent = "";
      ph.composer.classList.remove("has-text");
      ph.avatar.classList.remove("is-away", "is-happy", "is-pop");
      const fl = flyers[who];
      fl.el.getAnimations().forEach((a) => a.cancel());
      fl.el.classList.remove("is-on", "is-flying", "is-talking", "is-happy");
      fl.parked = null;
      hush(who);
      beams[who].target = beams[who].level = 0;
      ph.el.style.transitionDelay = "0ms";
    }
    photons.length = 0;
    particles.length = 0;
    agree.classList.remove("is-in");
    cloud.classList.remove("is-pulse");
    applyLayout();
    void root.offsetWidth;
  }

  async function play(from = 0) {
    const id = ++run;
    reset();
    try {
      for (let c = 0; c < STORY.length; c++) {
        fast = reduce || c < from;
        root.classList.toggle("is-instant", fast);
        if (!fast) void root.offsetWidth;
        setChapter(c);
        await STORY[c](id);
        setProgress(c, 1);
        chapterStart = null;
        if (reduce && c >= from) break;
      }
      fast = false;
      root.classList.remove("is-instant");
      if (reduce) return;
      await wait(7000, id);
      play(0);
    } catch (err) {
      // A cancelled run must not touch state the run that replaced it now owns.
      if (id === run) fast = false;
      if (!(err instanceof Stop)) throw err;
    }
  }

  // ------------------------------------------------------------------ wiring

  if (finePointer && !reduce) {
    root.addEventListener("pointermove", (e) => {
      const r = root.getBoundingClientRect();
      px = ((e.clientX - r.left) / r.width) * 2 - 1;
      py = ((e.clientY - r.top) / r.height) * 2 - 1;
      root.style.setProperty("--px", px.toFixed(3));
      root.style.setProperty("--py", py.toFixed(3));
    });
    root.addEventListener("pointerleave", () => {
      px = py = 0;
      root.style.setProperty("--px", 0);
      root.style.setProperty("--py", 0);
    });
  }

  let resizeTimer = 0;
  new ResizeObserver(() => {
    if (!L || Math.abs(root.clientWidth - L.W) < 1) return;
    clearTimeout(resizeTimer);
    root.classList.add("is-instant");
    applyLayout();
    // Muses standing on the cloud move with it.
    for (const who of WHO) {
      const fl = flyers[who];
      if (fl.parked == null) continue;
      const p = slotPoint(fl.parked);
      fl.el.getAnimations().forEach((a) => a.cancel());
      fl.el.style.offsetPath = `path("M ${p.x} ${p.y} L ${p.x} ${p.y}")`;
      fl.el.animate([{ offsetDistance: "100%" }], { duration: 0, fill: "forwards" });
    }
    resizeTimer = setTimeout(() => { if (!fast) root.classList.remove("is-instant"); }, 60);
  }).observe(root);

  applyLayout();
  if (reduce) {
    play(STORY.length - 1);
  } else {
    // Show the opening frame right away; start playing once the demo scrolls into view.
    reset();
    root.classList.remove("is-instant");
    setChapter(0);
    chapterStart = null;
  }
  let started = false;
  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    if (inView) startLoop();
    if (inView && !started && !reduce) { started = true; play(0); }
  }, { threshold: 0.2 }).observe(root);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && inView) startLoop(); });
  figure.querySelector("[data-replay]")?.addEventListener("click", () => { setPaused(false); play(0); });
})();
