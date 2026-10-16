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
      // --z sizes the big phones, --zx the small ones that pop in for the group.
      const z = cols === 1 ? Math.min(0.88, inner / 300) : cols === 2 ? Math.min(1, (inner - parseFloat(cs.columnGap)) / 2 / 300) : 1;
      const zx = cols === 1 ? Math.min(0.44, (inner - 10) / 600) : cols === 2 ? Math.min(0.5, (inner - 30) / 1200) : 0.42;
      demoStage.style.setProperty("--z", z.toFixed(3));
      demoStage.style.setProperty("--zx", zx.toFixed(3));
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

  // ---------------------------------------------------------------- the hero demo: phones, and Muses meeting in the cloud

  const stage = document.querySelector("[data-demo]");
  if (stage) {
    const muses = {
      you: "--body:#a4d3f4;--hat:#6f7c50;--knit:#a8592b",
      them: "--body:#f6bccd;--hat:#2f8f86;--knit:#3d4f7a",
      sam: "--body:#bfe8cf;--hat:#c2523d;--knit:#e3b341",
      priya: "--body:#f7d79a;--hat:#5b4aa8;--knit:#6a8f3e"
    };
    const sparkColors = ["#9b85ff", "#a4d3f4", "#f6bccd", "#f7d79a"];
    const wide = matchMedia("(min-width: 1001px)");
    const $ = (s) => stage.querySelector(s);
    const acts = [...stage.closest(".demo").querySelectorAll("[data-acts] li")];
    const steps = [...stage.querySelectorAll("[data-s]")];
    const pills = [...stage.querySelectorAll(".pill")];
    const slots = [...stage.querySelectorAll("[data-slot]")];
    const cloud = $("[data-cloud]");
    const agree = $(".cloud-agree");
    stage.classList.add("is-live");

    const flyers = {};
    for (const [name, style] of Object.entries(muses)) {
      const f = document.createElement("div");
      f.className = "flyer";
      f.innerHTML = `<svg class="m" viewBox="0 0 100 100" style="${style}"><use href="#cozy"/></svg>`;
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
    const jitter = (ms) => ms * (0.8 + Math.random() * 0.4);
    const at = (el) => {
      const r = el.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      return { x: r.left - s.left - stage.clientLeft + r.width / 2, y: r.top - s.top - stage.clientTop + r.height / 2 };
    };
    // Which avatar a Muse lives in right now: the big phones, or the small ones that pop in for the group
    // (narrower screens swap the big phones for all four small ones).
    const avatarOf = (who) => {
      const small = !(who === "you" || who === "them") || (stage.classList.contains("is-group") && !wide.matches);
      return $(small ? `.mini-${who} [data-avatar]` : `.ph-${who} [data-avatar]`);
    };
    // On phones only one big phone shows at a time (see styles.css).
    const view = (who) => { stage.dataset.view = who; };
    const act = (n) => acts.forEach((li, i) => li.classList.toggle("is-on", i === n - 1));
    const ping = (who) => {
      const a = avatarOf(who);
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
    // Fly a Muse from one element to another. It grows out of an avatar and shrinks back into one.
    const fly = (f, fromEl, toEl, { lift = 80, ms = 1150 } = {}) => new Promise((resolve) => {
      const from = at(fromEl);
      const to = at(toEl);
      const size = (el) => Math.min(1.1, Math.max(0.35, el.getBoundingClientRect().width / f.offsetWidth));
      const c = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift };
      f.getAnimations().forEach((a) => a.cancel());
      f.style.offsetPath = `path("M ${from.x} ${from.y} Q ${c.x} ${c.y} ${to.x} ${to.y}")`;
      f.classList.add("is-on", "is-flying");
      const a = f.animate(
        [{ offsetDistance: "0%", scale: size(fromEl) }, { offsetDistance: "100%", scale: size(toEl) }],
        { duration: ms, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "forwards" }
      );
      const trail = setInterval(() => spark(f), 50);
      const done = () => { clearInterval(trail); f.classList.remove("is-flying"); resolve(); };
      a.onfinish = done;
      a.oncancel = done;
    });
    const home = (...names) => names.forEach((n) => flyers[n].classList.remove("is-on"));

    // Typing with a human rhythm: uneven keys, little pauses after words and punctuation, and
    // negative numbers in `parts` backspace over a typo.
    const type = async (who, parts, id) => {
      const box = $(`[data-composer="${who}"]`);
      const typed = box.querySelector(".ph-typed");
      await wait(jitter(500), id);
      let prev = "";
      for (const part of parts) {
        if (typeof part === "number") {
          await wait(jitter(420), id);
          for (let i = 0; i < -part; i++) {
            typed.textContent = [...typed.textContent].slice(0, -1).join("");
            await wait(jitter(65), id);
          }
          await wait(jitter(220), id);
          continue;
        }
        for (const ch of part) {
          typed.textContent += ch;
          box.classList.add("has-text");
          let ms = 40 + Math.random() * 75;
          if (ch === " " && Math.random() < 0.25) ms += 180;
          if (/[,.!?:]/.test(prev)) ms += 200;
          prev = ch;
          await wait(ms, id);
        }
      }
      await wait(jitter(380), id);
      const send = box.querySelector(".ph-send");
      send.classList.add("is-press");
      await wait(140, id);
      send.classList.remove("is-press");
      typed.textContent = "";
      box.classList.remove("has-text");
    };
    // Show a text. A Muse "types" for about as long as its message would take.
    const show = async (s, id, { think } = {}) => {
      const el = stage.querySelector(`[data-s="${s}"]`);
      if (el.classList.contains("muse")) {
        const ms = think ?? Math.min(1700, 450 + el.textContent.trim().length * 16);
        const dots = document.createElement("div");
        dots.className = "typing-bubble";
        dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
        el.before(dots);
        try { await wait(jitter(ms), id); } finally { dots.remove(); }
      }
      el.classList.add("is-in");
      await wait(jitter(450), id);
    };
    // A Muse speaks in the cloud: typing dots in its bubble, then the words, left up long enough to read.
    const say = async (i, text, id) => {
      const p = pills[i];
      p.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
      p.classList.add("is-in");
      await wait(jitter(750), id);
      p.textContent = text;
      await wait(800 + text.length * 30, id);
    };
    const hush = (...is) => is.forEach((i) => pills[i].classList.remove("is-in"));

    const reset = () => {
      steps.forEach((s) => s.classList.remove("is-in"));
      hush(0, 1, 2, 3);
      agree.classList.remove("is-in");
      stage.classList.remove("is-group", "is-pair", "is-meet");
      cloud.classList.remove("is-pulse");
      stage.querySelectorAll(".typing-bubble, .spark").forEach((e) => e.remove());
      stage.querySelectorAll(".ph-typed").forEach((e) => { e.textContent = ""; });
      stage.querySelectorAll(".has-text").forEach((e) => e.classList.remove("has-text"));
      for (const f of Object.values(flyers)) {
        f.getAnimations().forEach((a) => a.cancel());
        f.classList.remove("is-on", "is-flying");
      }
      act(0);
      view("you");
    };

    const play = async () => {
      const id = ++run;
      reset();
      try {
        await wait(600, id);

        // 1. You text your Muse, double-texting like people do.
        act(1);
        await type("you", ["hey! can you set up dinnr", -2, "er with Alex sometime this week?"], id);
        await show("y1", id);
        await type("you", ["somewhere with good veggie options 🌱"], id);
        await show("y1b", id);
        await show("y2", id);

        // 2. Both Muses fly up and meet in the cloud.
        act(2);
        stage.classList.add("is-pair");
        ping("you");
        await fly(flyers.you, avatarOf("you"), slots[0]);
        check(id);
        await say(0, "Hi Bramble! Is Alex free for dinner this week?", id);
        view("them");
        ping("them");
        await fly(flyers.them, avatarOf("them"), slots[1]);
        check(id);
        await pulse(id, 500);
        await say(1, "Thursday after 7 looks open. Let me check with Alex!", id);
        await say(0, "Sure, I'll wait right here ☁️", id);

        // 3. Bramble pops home to ask Alex, then brings the answer back.
        act(3);
        hush(1);
        await fly(flyers.them, slots[1], avatarOf("them"), { ms: 900 });
        check(id);
        home("them");
        ping("them");
        await show("t1", id);
        await show("t1b", id, { think: 800 });
        await type("them", ["omg yes"], id);
        await show("t2", id);
        await type("them", ["thrusday", -6, "ursday's perfect"], id);
        await show("t2b", id);
        await show("t3", id);
        ping("them");
        await fly(flyers.them, avatarOf("them"), slots[1], { ms: 900 });
        check(id);
        act(2);
        hush(0);
        await say(1, "Alex says yes! 🙌", id);
        view("you");
        await say(0, "Perfect. I'll book Olive for 7 🍝", id);
        hush(0, 1);
        stage.classList.remove("is-pair");
        await Promise.all([
          fly(flyers.you, slots[0], avatarOf("you")),
          sleep(150).then(() => fly(flyers.them, slots[1], avatarOf("them")))
        ]);
        check(id);
        home("you", "them");
        ping("you");
        await show("y3", id);
        await show("y3b", id, { think: 1000 });
        await wait(1600, id);

        // 4. A bigger plan: four friends' phones pop in and their Muses gather in the cloud.
        act(1);
        await type("you", ["ok next up: Sam's birthday 🎂"], id);
        await show("y4", id);
        await type("you", ["can you get everyone together?"], id);
        await show("y4b", id);
        await show("y5", id);
        act(4);
        stage.classList.add("is-group");
        await wait(1000, id);
        const order = ["you", "them", "sam", "priya"];
        order.forEach(ping);
        await Promise.all(order.map((who, i) => sleep(i * 180).then(() => fly(flyers[who], avatarOf(who), slots[i], { ms: 1250 }))));
        check(id);
        stage.classList.add("is-meet");
        await say(0, "Saturday for Sam's birthday?", id);
        await say(1, "Alex is free all weekend", id);
        await say(2, "Sam can do 8. Loves sushi 🍣", id);
        await say(3, "I'll book Sushi Kaz", id);
        agree.classList.add("is-in");
        await pulse(id, 1600);
        hush(0, 1, 2, 3);
        agree.classList.remove("is-in");
        stage.classList.remove("is-meet");
        await Promise.all(order.map((who, i) => sleep(i * 120).then(() => fly(flyers[who], slots[i], avatarOf(who)))));
        check(id);
        home(...order);
        order.forEach(ping);
        await Promise.all([
          show("y6", id), show("my1", id),
          sleep(300).then(() => show("t4", id)), sleep(300).then(() => show("al1", id)),
          sleep(600).then(() => show("sm1", id)), sleep(900).then(() => show("pr1", id))
        ]);

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
