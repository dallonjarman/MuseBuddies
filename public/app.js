// Landing page behavior: theme toggle, rotating name, the hero phone demo, use-case picker,
// and the small live demos inside feature cards. Everything is readable without JavaScript;
// with reduced motion, demos show their final state.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const onVisible = (el, fn, threshold = 0.35) => {
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { io.disconnect(); fn(); }
    }, { threshold });
    io.observe(el);
  };

  // ---------------------------------------------------------------- theme

  const root = document.documentElement;
  const toggle = document.querySelector(".theme-toggle");
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const label = () => toggle?.setAttribute("aria-label", isDark() ? "Switch to light theme" : "Switch to dark theme");
  label();
  toggle?.addEventListener("click", () => {
    root.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("mt-theme", root.dataset.theme); } catch { /* private mode */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark() ? "#0b0b0e" : "#ffffff");
    label();
  });

  // ---------------------------------------------------------------- picker (works with or without motion)

  const tabs = [...document.querySelectorAll('.picker-tabs [role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });

  // ---------------------------------------------------------------- shrink the demo phones to fit (with or without motion)

  const demoStage = document.querySelector("[data-demo]");
  if (demoStage) {
    const fit = () => {
      const cs = getComputedStyle(demoStage);
      const inner = demoStage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const cols = cs.gridTemplateColumns.split(" ").length;
      const z = cols === 1 ? Math.min(0.88, inner / 300) : cols === 2 ? Math.min(1, (inner - parseFloat(cs.columnGap)) / 2 / 300) : 1;
      demoStage.style.setProperty("--z", z.toFixed(3));
    };
    fit();
    new ResizeObserver(fit).observe(demoStage);
  }

  if (reduce) return;

  // ---------------------------------------------------------------- rotating name in the headline

  const words = [...document.querySelectorAll(".rot-word")];
  if (words.length > 1) {
    let i = 0;
    setInterval(() => {
      if (document.hidden) return;
      const cur = words[i];
      i = (i + 1) % words.length;
      cur.classList.remove("is-on");
      cur.classList.add("is-out");
      words[i].classList.remove("is-out");
      words[i].classList.add("is-on");
      setTimeout(() => cur.classList.remove("is-out"), 400);
    }, 2400);
  }

  // ---------------------------------------------------------------- the hero demo: you, the relay cloud, Alex

  const stage = document.querySelector("[data-demo]");
  if (stage) {
    const muses = {
      you: "--body:#a4d3f4;--hat:#6f7c50;--knit:#a8592b",
      them: "--body:#f6bccd;--hat:#2f8f86;--knit:#3d4f7a",
      sam: "--body:#bfe8cf;--hat:#c2523d;--knit:#e3b341",
      priya: "--body:#f7d79a;--hat:#5b4aa8;--knit:#6a8f3e"
    };
    const sparkColors = ["#9b85ff", "#a4d3f4", "#f6bccd", "#f7d79a"];
    const $ = (s) => stage.querySelector(s);
    const acts = [...stage.closest(".demo").querySelectorAll("[data-acts] li")];
    const steps = [...stage.querySelectorAll("[data-s]")];
    const pills = [...stage.querySelectorAll(".pill")];
    const slots = [...stage.querySelectorAll("[data-slot]")];
    const cloud = $("[data-cloud]");
    const agree = $(".cloud-agree");
    const avatar = { you: $('[data-avatar="you"]'), them: $('[data-avatar="them"]') };
    stage.classList.add("is-live");

    const flyers = {};
    for (const [name, style] of Object.entries(muses)) {
      const f = document.createElement("div");
      f.className = "flyer";
      f.innerHTML = `<svg class="m" viewBox="0 0 100 100" style="${style}"><use href="#cozy"/></svg><span class="fl-lock"><svg><use href="#i-lock"/></svg></span>`;
      stage.append(f);
      flyers[name] = f;
    }

    let run = 0;
    let inView = false;
    class Stop extends Error {}
    const check = (id) => { if (id !== run) throw new Stop(); };
    // Waits pause while the demo is off screen or the tab is hidden, so it never plays unseen.
    const wait = async (ms, id) => {
      await sleep(ms);
      while (id === run && (!inView || document.hidden)) await sleep(250);
      check(id);
    };
    const at = (el) => {
      const r = el.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      return { x: r.left - s.left - stage.clientLeft + r.width / 2, y: r.top - s.top - stage.clientTop + r.height / 2 };
    };
    // Muses land on top of the cloud, above its label.
    const inCloud = () => { const c = at(cloud); return { x: c.x, y: c.y - cloud.offsetHeight * 0.3 }; };
    const offstage = (dx) => { const c = at($(".sky")); return { x: c.x + dx, y: -60 }; };
    // On narrow screens only one phone shows at a time (see styles.css).
    const view = (who) => { stage.dataset.view = who; };
    const act = (n) => acts.forEach((li, i) => li.classList.toggle("is-on", i === n - 1));
    const ping = (who) => {
      const a = avatar[who];
      a.classList.remove("is-ping");
      void a.offsetWidth;
      a.classList.add("is-ping");
    };
    const pulse = async (id, ms = 700) => {
      cloud.classList.add("is-pulse");
      try { await wait(ms, id); } finally { cloud.classList.remove("is-pulse"); }
    };

    const spark = (f) => {
      const p = at(f);
      const s = document.createElement("span");
      s.className = "spark";
      s.style.cssText = `left:${p.x + (Math.random() - 0.5) * 14}px;top:${p.y + (Math.random() - 0.5) * 14}px;--c:${sparkColors[(Math.random() * sparkColors.length) | 0]}`;
      s.addEventListener("animationend", () => s.remove());
      stage.append(s);
    };
    const fly = (f, from, to, { lift = 100, ms = 1150, mail = false } = {}) => new Promise((resolve) => {
      const c = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift };
      f.getAnimations().forEach((a) => a.cancel());
      f.style.offsetPath = `path("M ${from.x} ${from.y} Q ${c.x} ${c.y} ${to.x} ${to.y}")`;
      f.classList.toggle("has-mail", mail);
      f.classList.add("is-on", "is-flying");
      const a = f.animate([{ offsetDistance: "0%" }, { offsetDistance: "100%" }], { duration: ms, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "forwards" });
      const trail = setInterval(() => spark(f), 50);
      const done = () => { clearInterval(trail); f.classList.remove("is-flying"); resolve(); };
      a.onfinish = done;
      a.oncancel = done;
    });
    const land = (...fs) => fs.forEach((f) => f.classList.remove("is-on", "has-mail"));

    const type = async (who, text, id) => {
      const box = $(`[data-composer="${who}"]`);
      const typed = box.querySelector(".ph-typed");
      for (const ch of text) {
        typed.textContent += ch;
        box.classList.add("has-text");
        await wait(30 + Math.random() * 45, id);
      }
      await wait(350, id);
      const send = box.querySelector(".ph-send");
      send.classList.add("is-press");
      await wait(150, id);
      send.classList.remove("is-press");
      typed.textContent = "";
      box.classList.remove("has-text");
    };
    const show = async (s, id, think = 0) => {
      const el = stage.querySelector(`[data-s="${s}"]`);
      if (think) {
        const dots = document.createElement("div");
        dots.className = "typing-bubble";
        dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
        el.before(dots);
        try { await wait(think, id); } finally { dots.remove(); }
      }
      el.classList.add("is-in");
      await wait(400, id);
    };

    const reset = () => {
      steps.forEach((s) => s.classList.remove("is-in"));
      pills.forEach((p) => p.classList.remove("is-in"));
      agree.classList.remove("is-in");
      stage.classList.remove("is-group");
      cloud.classList.remove("is-pulse");
      stage.querySelectorAll(".typing-bubble, .spark").forEach((e) => e.remove());
      stage.querySelectorAll(".ph-typed").forEach((e) => { e.textContent = ""; });
      stage.querySelectorAll(".has-text").forEach((e) => e.classList.remove("has-text"));
      for (const f of Object.values(flyers)) {
        f.getAnimations().forEach((a) => a.cancel());
        land(f);
      }
      act(0);
      view("you");
    };

    const play = async () => {
      const id = ++run;
      reset();
      try {
        await wait(700, id);

        // 1. You ask your Muse.
        act(1);
        await type("you", "Can you set up dinner with Alex this week?", id);
        await show("y1", id);
        await show("y2", id, 900);

        // 2. Your Muse flies through the relay, carrying a sealed message.
        act(2);
        ping("you");
        await fly(flyers.you, at(avatar.you), inCloud(), { mail: true });
        check(id);
        view("them");
        await pulse(id);
        await fly(flyers.you, inCloud(), at(avatar.them), { mail: true });
        check(id);
        land(flyers.you);
        ping("them");

        // 3. Alex's Muse checks with Alex, then answers.
        act(3);
        await show("t1", id, 900);
        await wait(600, id);
        await type("them", "Yes! Thursday works", id);
        await show("t2", id);
        await show("t3", id, 800);

        act(2);
        ping("them");
        await fly(flyers.them, at(avatar.them), inCloud(), { mail: true });
        check(id);
        view("you");
        await pulse(id, 600);
        await fly(flyers.them, inCloud(), at(avatar.you), { mail: true });
        check(id);
        land(flyers.them);
        ping("you");
        act(1);
        await show("y3", id, 800);
        await wait(1800, id);

        // 4. A group: four Muses meet in the relay and work it out together.
        await type("you", "Now plan Sam's birthday with everyone", id);
        await show("y4", id);
        await show("y5", id, 800);
        act(4);
        stage.classList.add("is-group");
        ping("you");
        ping("them");
        const away = [offstage(-150), offstage(150)];
        await Promise.all([
          fly(flyers.you, at(avatar.you), at(slots[0]), { ms: 1300 }),
          sleep(200).then(() => fly(flyers.them, at(avatar.them), at(slots[1]), { ms: 1300 })),
          sleep(400).then(() => fly(flyers.sam, away[0], at(slots[2]), { ms: 1300, lift: 10 })),
          sleep(550).then(() => fly(flyers.priya, away[1], at(slots[3]), { ms: 1300, lift: 10 }))
        ]);
        check(id);
        for (const p of pills) {
          p.classList.add("is-in");
          await wait(1050, id);
        }
        agree.classList.add("is-in");
        await pulse(id, 1400);
        pills.forEach((p) => p.classList.remove("is-in"));
        agree.classList.remove("is-in");
        stage.classList.remove("is-group");
        await Promise.all([
          fly(flyers.you, at(slots[0]), at(avatar.you)),
          fly(flyers.them, at(slots[1]), at(avatar.them)),
          fly(flyers.sam, at(slots[2]), away[0], { lift: 10 }),
          fly(flyers.priya, at(slots[3]), away[1], { lift: 10 })
        ]);
        check(id);
        land(...Object.values(flyers));
        ping("you");
        ping("them");
        await Promise.all([show("y6", id, 900), show("t4", id, 1300)]);

        await wait(7000, id);
        play();
      } catch (err) {
        if (!(err instanceof Stop)) throw err;
      }
    };

    let started = false;
    new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      if (inView && !started) { started = true; play(); }
    }, { threshold: 0.25 }).observe(stage);
    stage.closest(".demo").querySelector("[data-replay]")?.addEventListener("click", play);
  }

  // ---------------------------------------------------------------- availability week

  const week = document.querySelector("[data-week]");
  if (week) {
    week.classList.add("is-live");
    onVisible(week, async () => {
      for (const p of ["p1", "p2", "p3", "p4"]) {
        week.classList.add(p);
        await sleep(750);
      }
    });
  }

  // ---------------------------------------------------------------- routines play their run log

  for (const routine of document.querySelectorAll("[data-routine]")) {
    const steps = [...routine.querySelectorAll(".rt-log > li")];
    routine.classList.add("is-live");
    onVisible(routine, async () => {
      for (const step of steps) {
        step.classList.add("is-in");
        await sleep(step.classList.contains("in") ? 1100 : 700);
      }
    }, 0.45);
  }

  // ---------------------------------------------------------------- receipts tick through

  const receipts = document.querySelector("[data-receipts]");
  if (receipts) {
    receipts.classList.add("is-live");
    const items = [...receipts.querySelectorAll("li")];
    onVisible(receipts, async () => {
      for (;;) {
        items.forEach((li) => li.classList.remove("is-done"));
        await sleep(700);
        for (const li of items) { li.classList.add("is-done"); await sleep(900); }
        await sleep(3200);
      }
    });
  }

  // ---------------------------------------------------------------- switch, backup

  const sw = document.querySelector("[data-switch]");
  if (sw) onVisible(sw, async () => { sw.classList.remove("is-on"); await sleep(700); sw.classList.add("is-on"); });
  const backup = document.querySelector("[data-backup]");
  if (backup) onVisible(backup, () => backup.classList.add("is-live"));

  // ---------------------------------------------------------------- relay sees noise

  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (const cipher of document.querySelectorAll("[data-cipher], [data-cipher2]")) {
    const len = cipher.textContent.length;
    const noise = () => Array.from({ length: len }, () => A[(Math.random() * 64) | 0]).join("");
    onVisible(cipher, () => setInterval(() => { if (!document.hidden) cipher.textContent = noise(); }, cipher.hasAttribute("data-cipher2") ? 700 : 1500));
  }

  // ---------------------------------------------------------------- terminal types itself

  const term = document.querySelector("[data-term]");
  if (term) {
    const html = term.innerHTML;
    onVisible(term, async () => {
      const lines = html.split("\n");
      term.innerHTML = "";
      for (const line of lines) {
        const isCmd = line.startsWith("<b>");
        if (isCmd) {
          const text = line.replace(/<[^>]+>/g, "").replace(/^\$ /, "");
          term.insertAdjacentHTML("beforeend", "<b>$</b> ");
          for (const ch of text) { term.insertAdjacentText("beforeend", ch); await sleep(45); }
          term.insertAdjacentText("beforeend", "\n");
          await sleep(500);
        } else {
          term.insertAdjacentHTML("beforeend", line + "\n");
          await sleep(380);
        }
      }
    });
  }
})();
