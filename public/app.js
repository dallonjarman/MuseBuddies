// Landing page behavior: theme toggle, rotating name, the Muse chat playback, use-case picker,
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

  // ---------------------------------------------------------------- the Muse chat

  const chat = document.querySelector("[data-chat]");
  if (chat) {
    const steps = [...chat.querySelectorAll("[data-step]")];
    let run = 0;
    const typing = document.createElement("div");
    typing.className = "typing-bubble";
    typing.setAttribute("aria-hidden", "true");
    typing.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
    const play = async () => {
      const id = ++run;
      chat.classList.add("is-live");
      steps.forEach((s) => s.classList.remove("is-in"));
      typing.remove();
      await sleep(500);
      for (const step of steps) {
        if (id !== run) return;
        const mine = step.classList.contains("me");
        if (!mine) {
          chat.insertBefore(typing, step);
          await sleep(step.classList.contains("relay-card") ? 1500 : 1000);
          if (id !== run) return;
          typing.remove();
        } else {
          await sleep(650);
        }
        step.classList.add("is-in");
        await sleep(450);
      }
    };
    onVisible(chat, play, 0.4);
    document.querySelector("[data-replay]")?.addEventListener("click", play);
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

  const cipher = document.querySelector("[data-cipher]");
  if (cipher) {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const noise = () => Array.from({ length: 20 }, () => A[(Math.random() * 64) | 0]).join("");
    onVisible(cipher, () => setInterval(() => { if (!document.hidden) cipher.textContent = noise(); }, 1500));
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
