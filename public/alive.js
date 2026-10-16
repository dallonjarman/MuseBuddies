// Moments below the hero, each played when it scrolls into view:
//  - the Muse conversation types itself out, line by line, with a replay control
//  - three people's free evenings fill a week grid until the overlap lights up
//  - a message crosses the relay: plain text, scrambled in the middle, plain again
// Everything is fully rendered in the HTML; with reduced motion or no JS, the final state shows.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const whenVisible = (el, ratio, fn) => {
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        io.disconnect();
        fn();
      }
    }, { threshold: ratio });
    io.observe(el);
  };

  // ---------------------------------------------------------------- conversation

  const script = document.querySelector(".script");
  if (script) {
    const lines = [...script.querySelectorAll(".line")];
    const replay = document.querySelector(".replay");
    let run = 0;
    for (const line of lines) {
      const said = line.querySelector(".said");
      const dots = document.createElement("span");
      dots.className = "typing";
      dots.setAttribute("aria-hidden", "true");
      dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
      said.prepend(dots);
    }
    const reset = () => lines.forEach((l) => l.classList.remove("is-on", "is-typing", "is-said", "is-noted"));
    async function play() {
      const id = ++run;
      script.classList.add("is-live");
      replay?.classList.remove("is-shown");
      reset();
      await sleep(300);
      for (const line of lines) {
        if (id !== run) return;
        const you = line.querySelector(".speaker.you");
        const text = line.querySelector(".said").textContent.trim();
        line.classList.add("is-on", "is-typing");
        await sleep(you ? 550 : Math.min(1700, 650 + text.length * 14));
        if (id !== run) return;
        line.classList.remove("is-typing");
        line.classList.add("is-said");
        await sleep(380);
        line.classList.add("is-noted");
        await sleep(520);
      }
      replay?.classList.add("is-shown");
    }
    script.classList.add("is-live");
    reset();
    whenVisible(script, 0.25, play);
    replay?.addEventListener("click", () => {
      script.scrollIntoView({ behavior: "smooth", block: "start" });
      play();
    });
  }

  // ---------------------------------------------------------------- week grid

  const week = document.querySelector(".week");
  if (week) {
    week.classList.add("is-live");
    whenVisible(week, 0.35, async () => {
      for (const who of ["you", "alex", "sam"]) {
        week.classList.add(`show-${who}`);
        await sleep(900);
      }
      week.classList.add("show-overlap");
    });
  }

  // ---------------------------------------------------------------- the relay wire

  const wire = document.querySelector(".wire");
  if (wire) {
    const from = wire.querySelector("[data-from]");
    const middle = wire.querySelector("[data-relay]");
    const to = wire.querySelector("[data-to]");
    const dot = wire.querySelector(".wire-dot");
    const messages = [
      "Thursday after 7 works.",
      "Free Thu 7 to 10 pm, Sat 6 to 9 pm.",
      "Sam's vegetarian, if that helps.",
      "Booked: Olive, Thursday at 7."
    ];
    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const noise = (n) => Array.from({ length: n }, () => ALPHABET[(Math.random() * 64) | 0]).join("");
    let visible = false;
    new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.2 }).observe(wire);

    async function type(el, text) {
      el.textContent = "";
      for (let i = 1; i <= text.length; i++) {
        el.textContent = text.slice(0, i);
        await sleep(26);
      }
    }
    async function travel(fromPct, toPct) {
      dot.style.setProperty("--from", fromPct);
      dot.style.setProperty("--to", toPct);
      dot.classList.remove("is-moving");
      void dot.offsetWidth;
      dot.classList.add("is-moving");
      await sleep(650);
    }
    async function loop() {
      wire.classList.add("is-live");
      for (let i = 0; ; i = (i + 1) % messages.length) {
        while (!visible || document.hidden) await sleep(400);
        const text = messages[i];
        to.textContent = "";
        middle.textContent = "";
        await type(from, text);
        await travel("0%", "50%");
        // Encrypt: the relay only ever holds noise of roughly the message's length plus a tag.
        const len = Math.ceil(((text.length + 16) * 4) / 3);
        for (let k = 0; k < 14; k++) {
          middle.textContent = noise(len);
          await sleep(55);
        }
        await sleep(500);
        await travel("50%", "100%");
        await type(to, text);
        await sleep(2200);
      }
    }
    whenVisible(wire, 0.3, loop);
  }
})();
