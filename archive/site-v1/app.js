// Landing page behavior: theme toggle, rotating name, use-case picker, routines and the terminal.
// The hero demo is demo.js and the feature playground is play.js. Everything is readable without
// JavaScript; with reduced motion, demos show their final state.
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
          for (const ch of text) { term.insertAdjacentText("beforeend", ch); await sleep(26); }
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
