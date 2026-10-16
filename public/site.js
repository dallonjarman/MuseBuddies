const button = document.getElementById("copyBtn");
const statusEl = document.getElementById("copyStatus");
const note = document.querySelector("[data-copy-note]");
const fullUrl = document.getElementById("fullUrl");

if (fullUrl) {
  const update = () => {
    const url = new URL(location.href);
    const parts = url.pathname.split("/").filter(Boolean);
    const valid = parts[0] === "invite" && parts.length === 2 && parts[1].length >= 8 && /^[A-Za-z0-9_-]{22,}$/.test(url.hash.slice(1));
    document.getElementById("invalidInvite").hidden = valid;
    document.getElementById("inviteAction").hidden = !valid;
    button.disabled = !valid;
    fullUrl.textContent = valid ? url.href : "";
  };
  update();
  addEventListener("hashchange", update);
}

button?.addEventListener("click", async () => {
  const text = note.innerText.trim();
  try {
    await navigator.clipboard.writeText(text);
    statusEl.classList.remove("error");
    statusEl.textContent = "Copied. Paste it into your Muse chat and send it.";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(note);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    statusEl.classList.add("error");
    statusEl.textContent = "Couldn't copy automatically. The note is selected; copy it and paste it into your Muse chat.";
  }
});
