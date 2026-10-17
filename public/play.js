// The feature playground ("Try it yourself") and the copy button in "Under the hood". Each widget
// is a small working model of a MuseBuddies feature. Without JavaScript every panel shows as
// static content.
(() => {
  const pg = document.querySelector("[data-playground]");
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const art = (who) => window.MuseArt?.svg(who) ?? "";

  // ------------------------------------------------------------------ copy a command

  for (const btn of $$("[data-copy-cmd]")) {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copyCmd);
        btn.classList.add("is-done");
        btn.setAttribute("aria-label", "Copied");
        setTimeout(() => { btn.classList.remove("is-done"); btn.setAttribute("aria-label", "Copy command"); }, 1600);
      } catch { /* clipboard blocked; the command is on screen to copy by hand */ }
    });
  }

  if (!pg) return;
  pg.classList.add("is-live");

  // ------------------------------------------------------------------ tabs

  const tabs = $$('[role="tab"]', pg);
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) tab.focus();
    tab.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const d = ["ArrowDown", "ArrowRight"].includes(e.key) ? 1 : ["ArrowUp", "ArrowLeft"].includes(e.key) ? -1 : 0;
      if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  select(tabs[0]);

  // ------------------------------------------------------------------ 1. a message, really encrypted

  {
    const input = $("[data-e2e-input]", pg);
    const out = $("[data-e2e-cipher]", pg);
    const plain = $("[data-e2e-plain]", pg);
    const wire = out.closest(".pg-wire");
    const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const subtle = window.crypto?.subtle;
    const keyP = subtle ? subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) : null;
    let seq = 0;
    const seal = async () => {
      const n = ++seq;
      const text = input.value;
      let shown = text;
      let cipher;
      if (keyP) {
        const key = await keyP;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
        const opened = await subtle.decrypt({ name: "AES-GCM", iv }, key, ct); // prove the round trip
        shown = new TextDecoder().decode(opened);
        cipher = b64url(new Uint8Array([...iv, ...ct]));
      } else {
        const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        cipher = Array.from({ length: Math.ceil(((text.length + 28) * 4) / 3) }, () => A[(Math.random() * 64) | 0]).join("");
      }
      if (n !== seq) return;
      out.textContent = cipher;
      plain.textContent = shown || "…";
      wire.classList.remove("is-sending");
      void wire.offsetWidth;
      wire.classList.add("is-sending");
    };
    let t = 0;
    input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(seal, 120); });
    seal();
  }

  // ------------------------------------------------------------------ 2. find a time

  {
    // Free evenings, 5 PM to 11 PM, as [day, from, to] in hours. Days run Monday to Sunday.
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const START = 17, END = 23;
    const PEOPLE = [
      { who: "you", name: "You", auto: "You", free: [[0, 17, 19], [1, 20, 23], [3, 18, 23], [4, 17, 21], [5, 17, 23]] },
      { who: "them", name: "Alex", auto: "Answers automatically", free: [[1, 17, 19], [3, 19, 23], [5, 18, 21], [6, 17, 20]] },
      { who: "sam", name: "Sam", auto: "Asks Sam first", free: [[0, 19, 23], [3, 17, 22], [4, 20, 23], [5, 18, 23]] },
      { who: "priya", name: "Priya", auto: "Answers automatically", free: [[0, 17, 23], [2, 18, 22], [3, 19, 22], [5, 17, 22], [6, 18, 21]] }
    ];
    const on = new Set(PEOPLE.map((p) => p.who));
    const color = (who) => window.MuseArt?.COLORS[who] ?? "#9b85ff";
    const peopleEl = $("[data-people]", pg);
    const grid = $("[data-week-grid]", pg);
    const best = $("[data-best]", pg);
    const pct = (h) => `${((h - START) / (END - START)) * 100}%`;
    const fmt = (h) => String(h > 12 ? h - 12 : h); // every slot is in the evening

    for (const p of PEOPLE) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pg-person";
      b.style.setProperty("--c", color(p.who));
      b.setAttribute("aria-pressed", "true");
      b.innerHTML = `<span class="pg-av" data-muse="${p.who}">${art(p.who)}</span><span><b>${p.name}</b><small>${p.auto}</small></span>`;
      if (p.who === "you") b.disabled = true; // you're always in your own plan
      b.addEventListener("click", () => {
        on.has(p.who) ? on.delete(p.who) : on.add(p.who);
        b.setAttribute("aria-pressed", String(on.has(p.who)));
        render();
      });
      peopleEl.append(b);
    }

    const hours = document.createElement("div");
    hours.className = "pg-hours";
    hours.innerHTML = `<span></span><div>${[17, 19, 21, 23].map((h) => `<span style="top:${pct(h)}">${fmt(h)}pm</span>`).join("")}</div>`;
    grid.append(hours);
    const days = DAYS.map((d, i) => {
      const col = document.createElement("div");
      col.className = "pg-day";
      col.innerHTML = `<b>${d}</b><div class="pg-track">${PEOPLE.map((p) => `<div class="pg-lane" data-who="${p.who}">${p.free.filter((f) => f[0] === i).map((f) => `<i style="--t:${pct(f[1])};--h:${pct(START + f[2] - f[1])};--c:${color(p.who)}"></i>`).join("")}</div>`).join("")}<span class="pg-overlap" hidden></span></div>`;
      grid.append(col);
      return col;
    });

    function render() {
      let top = null;
      days.forEach((col, i) => {
        for (const lane of $$(".pg-lane", col)) lane.classList.toggle("is-off", !on.has(lane.dataset.who));
        // Intersect everyone's free time on this day.
        let span = [START, END];
        for (const p of PEOPLE) {
          if (!on.has(p.who)) continue;
          const f = p.free.find((x) => x[0] === i);
          if (!f) { span = null; break; }
          span = [Math.max(span[0], f[1]), Math.min(span[1], f[2])];
          if (span[0] >= span[1]) { span = null; break; }
        }
        const ov = $(".pg-overlap", col);
        ov.hidden = !span || span[1] - span[0] < 2;
        if (!ov.hidden) {
          ov.style.setProperty("--t", pct(span[0]));
          ov.style.setProperty("--h", pct(START + span[1] - span[0]));
          if (!top || span[1] - span[0] > top.len) top = { i, span, len: span[1] - span[0] };
        }
        col.classList.remove("is-best");
      });
      const names = PEOPLE.filter((p) => on.has(p.who)).map((p) => (p.who === "you" ? "you" : p.name));
      const who = on.size === PEOPLE.length ? "everyone" : on.size === 1 ? "just you" : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
      if (top) {
        days[top.i].classList.add("is-best");
        best.innerHTML = `Best for ${who}: <b>${LONG[top.i]}, ${fmt(top.span[0])} to ${fmt(top.span[1])} PM</b>`;
      } else {
        best.innerHTML = `No evening works for ${who}. Your Muse would suggest next week, or ask who can be flexible.`;
      }
    }
    render();
  }

  // ------------------------------------------------------------------ 3. live updates

  {
    const feed = $("[data-feed]", pg);
    const UPDATES = [
      { html: "<b>Delayed 45 min.</b> New landing 8:25 PM, Terminal 3." },
      { html: "<b>Delayed 2 hours.</b> New landing 9:40 PM, Terminal 3." },
      { html: "<b>Missed the connection.</b> Rebooked on UA455, landing 11:15 PM, Terminal 3.", urgent: true },
      { html: "<b>Landed!</b> Walking to baggage claim, door 4.", good: true }
    ];
    const initial = feed.innerHTML;
    const tag = (text) => `<span class="pg-tag">${text}</span>`;
    for (const btn of $$("[data-flight]", pg)) {
      btn.addEventListener("click", () => {
        const u = UPDATES[+btn.dataset.flight];
        // A newer update with the same key replaces the unread one before it.
        for (const old of $$(".pg-item:not(.is-replaced)", feed)) {
          old.classList.remove("is-new", "is-urgent", "is-good");
          old.classList.add("is-replaced");
          $(".pg-tag", old)?.remove();
          old.insertAdjacentHTML("beforeend", tag("Replaced"));
        }
        const li = document.createElement("li");
        li.className = `pg-item is-new${u.urgent ? " is-urgent" : ""}${u.good ? " is-good" : ""}`;
        li.innerHTML = u.html + tag(u.urgent ? "Urgent" : "Latest");
        feed.append(li);
        while (feed.children.length > 4) feed.firstElementChild.remove();
      });
    }
    $("[data-flight-reset]", pg).addEventListener("click", () => { feed.innerHTML = initial; });
  }

  // ------------------------------------------------------------------ 4. receipts

  {
    const steps = $$("[data-ticks] li", pg);
    const btn = $("[data-send-receipt]", pg);
    steps.forEach((s) => s.classList.add("is-done"));
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      steps.forEach((s) => s.classList.remove("is-done"));
      for (const [i, s] of steps.entries()) {
        await sleep(reduce ? 0 : [500, 900, 1500][i]);
        s.classList.add("is-done");
      }
      btn.textContent = "Send again";
      btn.disabled = false;
    });
  }

  // ------------------------------------------------------------------ 5. groups

  {
    const stage = $("[data-group]", pg);
    const btn = $("[data-group-send]", stage);
    const members = $$(".pg-gm:not(.g-hub)", stage);
    stage.classList.add("is-live");
    members.forEach((m) => m.classList.add("is-replied"));
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      members.forEach((m) => m.classList.remove("is-replied", "is-ping"));
      stage.classList.add("is-sending");
      await sleep(reduce ? 0 : 700);
      members.forEach((m) => m.classList.add("is-ping"));
      stage.classList.remove("is-sending");
      for (const m of [members[0], members[2], members[1]]) {
        await sleep(reduce ? 0 : 650);
        m.classList.remove("is-ping");
        m.classList.add("is-replied");
      }
      btn.disabled = false;
    });
  }

  // ------------------------------------------------------------------ 6. a real calendar invite

  {
    const timeSel = $("[data-cal-time]", pg);
    const placeSel = $("[data-cal-place]", pg);
    const toast = $("[data-cal-toast]", pg);
    const card = $(".pg-event", pg);
    // Next Thursday from today.
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + (((4 - day.getDay() + 7) % 7) || 7));
    $("[data-cal-date]", pg).textContent = day.getDate();
    const clock = (hm) => { const [h, m] = hm.split(":").map(Number); return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
    const end = (hm) => { const [h, m] = hm.split(":").map(Number); return `${String(h + 2).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
    let first = true;
    const update = () => {
      $("[data-cal-title]", pg).textContent = `Dinner at ${placeSel.value}`;
      $("[data-cal-when]", pg).textContent = `Thursday, ${clock(timeSel.value)} to ${clock(end(timeSel.value))}`;
      if (first) { first = false; return; }
      toast.textContent = "✓ Updated on Alex's and Sam's calendars too";
      card.classList.remove("is-flash");
      void card.offsetWidth;
      card.classList.add("is-flash");
    };
    timeSel.addEventListener("change", update);
    placeSel.addEventListener("change", update);
    update();

    $("[data-cal-download]", pg).addEventListener("click", () => {
      const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const local = (hm) => {
        const [h, m] = hm.split(":").map(Number);
        const d = new Date(day);
        d.setHours(h, m, 0, 0);
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(h)}${p(m)}00`;
      };
      const uid = `${crypto.getRandomValues(new Uint32Array(2)).join("-")}@musebuddies`;
      const ics = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MuseBuddies//Website demo//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${local(timeSel.value)}`, `DTEND:${local(end(timeSel.value))}`,
        `SUMMARY:Dinner at ${placeSel.value}`, `LOCATION:${placeSel.value}`, "DESCRIPTION:Planned by your Muses with MuseBuddies (demo invite).",
        "STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR", ""
      ].join("\r\n");
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `dinner-at-${placeSel.value.toLowerCase().replace(/\s+/g, "-")}.ics` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.textContent = "✓ Invite downloaded. Open it to add it to your calendar.";
    });
  }

  // ------------------------------------------------------------------ 7. your rules

  {
    const box = $(".pg-rules", pg);
    const on = $("[data-rule-on]", pg);
    const weeks = $("[data-rule-weeks]", pg);
    const from = $("[data-rule-from]", pg);
    const to = $("[data-rule-to]", pg);
    const max = $("[data-rule-max]", pg);
    const summary = $("[data-rule-summary]", pg);
    const hour = (h) => (h == 24 ? "midnight" : h == 12 ? "noon" : `${h > 12 ? h - 12 : h} ${h >= 12 ? "PM" : "AM"}`);
    const render = () => {
      if (+from.value >= +to.value - 1) to.value = Math.min(24, +from.value + 2);
      const w = +weeks.value;
      $("[data-out-weeks]", pg).textContent = `${w} week${w > 1 ? "s" : ""}`;
      $("[data-out-from]", pg).textContent = hour(+from.value);
      $("[data-out-to]", pg).textContent = hour(+to.value);
      $("[data-out-max]", pg).textContent = max.value;
      box.classList.toggle("is-off", !on.checked);
      summary.textContent = on.checked
        ? `Bramble can check when you're free up to ${w} week${w > 1 ? "s" : ""} ahead, between ${hour(+from.value)} and ${hour(+to.value)}, up to ${max.value} time${max.value > 1 ? "s" : ""} a day. It never sees what's on your calendar.`
        : "Bramble can't check your free time. If Alex's Muse asks, your Muse checks with you first.";
    };
    for (const el of [on, weeks, from, to, max]) el.addEventListener("input", render);
    render();
  }
})();
