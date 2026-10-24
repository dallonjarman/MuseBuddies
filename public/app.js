// Page behavior that works with or without the 3D story: copying the setup note and the relay
// command, and the "Say yes" button on the plan card. The story itself is world.js.
(() => {
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = Object.assign(document.createElement("textarea"), { value: text });
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;opacity:0";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  };

  const button = document.getElementById("copyBtn");
  const status = document.getElementById("copyStatus");
  const note = document.querySelector("[data-copy-note]");
  const label = button?.querySelector("span");
  button?.addEventListener("click", async () => {
    const ok = await copy(note.textContent.trim());
    label.textContent = ok ? "Copied" : "Copy failed";
    status.textContent = ok ? "Copied. Now paste it into your Muse chat." : "Couldn't copy. Select the note and copy it yourself.";
    document.dispatchEvent(new CustomEvent("w:chime", { detail: { kind: "copy" } }));
    setTimeout(() => { label.textContent = "Copy the note"; }, 2400);
  });

  for (const btn of document.querySelectorAll("[data-copy-cmd]")) {
    btn.addEventListener("click", async () => {
      const ok = await copy(btn.dataset.copyCmd);
      btn.textContent = ok ? "Copied" : "Failed";
      setTimeout(() => { btn.textContent = "Copy"; }, 2000);
    });
  }

  const yes = document.querySelector("[data-yes]");
  yes?.addEventListener("click", () => {
    const plan = yes.closest(".w-plan");
    const on = !plan.classList.contains("is-yes");
    plan.classList.toggle("is-yes", on);
    yes.textContent = on ? "It's a plan" : "Say yes";
    if (on) document.dispatchEvent(new CustomEvent("w:chime", { detail: { kind: "yes" } }));
  });
})();
