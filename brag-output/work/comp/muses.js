// The four Muse characters, shared by the hero demo, the playground and the rest of the page.
// window.MuseArt.svg(who) returns an inline SVG; every face has a .dm-eyes group (it blinks) and
// .dm-happy eyes (shown when a plan is agreed). Elements with data-muse="you|them|sam|priya" are
// filled in automatically.
(() => {
  const rand = (a, b) => a + Math.random() * (b - a);
  // Each Muse has its own look. Every one has a .dm-eyes group (it blinks) and .dm-happy eyes
  // (shown when a plan is agreed), drawn in a 100×100 box with the face around the middle.
  const INK = "#17171c";
  const happyEyes = (y, l = 42, r = 58) => `<path class="dm-happy" d="M${l - 3.6} ${y + 1.4}q3.6-4.4 7.2 0M${r - 3.6} ${y + 1.4}q3.6-4.4 7.2 0" stroke="${INK}" stroke-width="2.1" fill="none" stroke-linecap="round"/>`;
  const CHARACTERS = {
    // Phaedra: a fluffy blue yeti in a corduroy bucket hat and a rust cable-knit sweater.
    you: `
      <path d="M23 99c-3-29 4-58 27-58s30 29 27 58Z" fill="#9fd0f5"/>
      <g fill="#9fd0f5"><circle cx="25.5" cy="64" r="5"/><circle cx="74.5" cy="64" r="5"/><circle cx="23.5" cy="73" r="5"/><circle cx="76.5" cy="73" r="5"/></g>
      <g fill="#c9e7fb" opacity=".8"><circle cx="34" cy="60" r="1.6"/><circle cx="66" cy="61" r="1.6"/><circle cx="30" cy="67" r="1.3"/><circle cx="70" cy="68" r="1.3"/></g>
      <path d="M19 80q31-11 62 0l4 20H15Z" fill="#b05a2a"/>
      <path d="M38 82q3.5 3.5 0 7t0 7M50 80q3.5 3.5 0 7t0 7t0 7M62 82q3.5 3.5 0 7t0 7" stroke="#86401c" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <rect x="31" y="69" width="38" height="12" rx="6" fill="#efe4cf"/>
      <path d="M37 70v10M43 70v10M49 70v10M55 70v10M61 70v10" stroke="#d6c7aa" stroke-width="1.3"/>
      <g class="dm-eyes"><circle cx="43" cy="57" r="3" fill="${INK}"/><circle cx="57" cy="57" r="3" fill="${INK}"/><circle cx="44" cy="56" r=".9" fill="#fff"/><circle cx="58" cy="56" r=".9" fill="#fff"/></g>
      ${happyEyes(57, 43, 57)}
      <ellipse cx="36.5" cy="62.5" rx="3.8" ry="2.2" fill="#f28fa6" opacity=".55"/><ellipse cx="63.5" cy="62.5" rx="3.8" ry="2.2" fill="#f28fa6" opacity=".55"/>
      <path d="M47 63q3 2.6 6 0" stroke="${INK}" stroke-width="1.7" fill="none" stroke-linecap="round"/>
      <path d="M30 47c0-17 9-25 20-25s20 8 20 25Z" fill="#6f7c50"/>
      <path d="M38 27v19M44 24v22M50 23v23M56 24v22M62 27v19" stroke="#000" stroke-opacity=".17" stroke-width="1.3"/>
      <ellipse cx="50" cy="48" rx="29" ry="7" fill="#6f7c50"/>
      <path d="M22 49q28 9 56 0" stroke="#efe4cf" stroke-width="2.8" fill="none" stroke-linecap="round"/>`,

    // Bramble: a lilac cat with round glasses and a striped scarf.
    them: `
      <path d="M27 44 31 15l17 17ZM73 44 69 15 52 32Z" fill="#c9a7f2"/>
      <path d="M31.5 37 33 22l9 9ZM68.5 37 67 22l-9 9Z" fill="#f4a8c4"/>
      <path d="M23 99c-2-34 6-67 27-67s29 33 27 67Z" fill="#c9a7f2"/>
      <path d="M38 34q12-5 24 0" stroke="#a983dd" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M45 30q5-3 10 0" stroke="#a983dd" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g class="dm-eyes"><circle cx="41" cy="54" r="2.8" fill="${INK}"/><circle cx="59" cy="54" r="2.8" fill="${INK}"/></g>
      ${happyEyes(54, 41, 59)}
      <g fill="#fff" fill-opacity=".22" stroke="#2b2840" stroke-width="2.2"><circle cx="41" cy="54" r="7.5"/><circle cx="59" cy="54" r="7.5"/></g>
      <path d="M48.5 53.5q1.5-1.5 3 0" stroke="#2b2840" stroke-width="2" fill="none"/>
      <path d="M48 61.5h4l-2 2.3Z" fill="#e0789f"/>
      <path d="M46 65.5q2 2 4 0q2 2 4 0" stroke="${INK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M27 63h9M27 67l9-1.5M73 63h-9M73 67l-9-1.5" stroke="#8f6cc4" stroke-width="1.1" stroke-linecap="round"/>
      <path d="M24 73q26 9 52 0v10q-26 9-52 0Z" fill="#e85d75"/>
      <path d="M33 76.5v10M42 78.5v10M51 79v10M60 78.5v10M69 76.5v10" stroke="#fff" stroke-width="3" opacity=".85"/>
      <path d="M57 85h11l-1 15H58Z" fill="#e85d75"/>
      <path d="M58 90h10M58 95h10" stroke="#fff" stroke-width="2.4" opacity=".85"/>`,

    // Pip: a round mint sprout with a leaf on top, freckles and sunny overalls.
    sam: `
      <path d="M50 38c0-7 0-12 1-17" stroke="#3f8f5a" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M51 24c-8-9-17-7-18-1 7 4 13 4 18 1Z" fill="#4caf6e"/>
      <path d="M51 22c8-10 19-9 20-2-7 5-14 5-20 2Z" fill="#5fc47f"/>
      <ellipse cx="50" cy="70" rx="29" ry="33" fill="#8fdcae"/>
      <ellipse cx="41" cy="50" rx="9" ry="5" fill="#b5ecc9" opacity=".7"/>
      <g class="dm-eyes"><ellipse cx="41" cy="61" rx="3.4" ry="3.9" fill="${INK}"/><ellipse cx="59" cy="61" rx="3.4" ry="3.9" fill="${INK}"/><circle cx="42.2" cy="59.6" r="1.2" fill="#fff"/><circle cx="60.2" cy="59.6" r="1.2" fill="#fff"/></g>
      ${happyEyes(61, 41, 59)}
      <g fill="#3f8f5a" opacity=".55"><circle cx="34" cy="66" r=".9"/><circle cx="37" cy="68" r=".9"/><circle cx="33" cy="69.5" r=".9"/><circle cx="66" cy="66" r=".9"/><circle cx="63" cy="68" r=".9"/><circle cx="67" cy="69.5" r=".9"/></g>
      <path d="M45 68q5 6 10 0Z" fill="#7a2e3a"/>
      <path d="M33 84h34v16H33Z" fill="#f2c14e"/>
      <path d="M33 84 27 76M67 84l6-8" stroke="#f2c14e" stroke-width="4.5" stroke-linecap="round"/>
      <circle cx="37" cy="88" r="2" fill="#c9952a"/><circle cx="63" cy="88" r="2" fill="#c9952a"/>
      <rect x="44" y="89" width="12" height="8" rx="2" fill="#e5ad33"/>`,

    // Marlow: an amber bear with coral headphones and a cosy purple hoodie.
    priya: `
      <circle cx="30" cy="38" r="9.5" fill="#e3a95c"/><circle cx="70" cy="38" r="9.5" fill="#e3a95c"/>
      <circle cx="30" cy="38" r="5" fill="#c98a3e"/><circle cx="70" cy="38" r="5" fill="#c98a3e"/>
      <path d="M23 99c-2-32 5-63 27-63s29 31 27 63Z" fill="#f0bf72"/>
      <ellipse cx="50" cy="64" rx="11.5" ry="8.5" fill="#fbe3b8"/>
      <ellipse cx="50" cy="60" rx="3.8" ry="2.7" fill="#3a2a1d"/>
      <path d="M50 62.5v3M46.5 66q3.5 2.6 7 0" stroke="#3a2a1d" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <g class="dm-eyes"><circle cx="41" cy="52" r="2.9" fill="${INK}"/><circle cx="59" cy="52" r="2.9" fill="${INK}"/></g>
      ${happyEyes(52, 41, 59)}
      <path d="M26 46c0-27 48-27 48 0" stroke="#2c2a36" stroke-width="5" fill="none" stroke-linecap="round"/>
      <rect x="18" y="41" width="12" height="19" rx="5.5" fill="#ff7a59"/><rect x="70" y="41" width="12" height="19" rx="5.5" fill="#ff7a59"/>
      <rect x="21" y="44" width="5" height="13" rx="2.5" fill="#ff9d84"/><rect x="74" y="44" width="5" height="13" rx="2.5" fill="#ff9d84"/>
      <path d="M18 81q32-12 64 0l4 19H14Z" fill="#6a5acd"/>
      <path d="M27 77q23 14 46 0" stroke="#5547b5" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M44 83v10M56 83v10" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="44" cy="94" r="1.8" fill="#fff"/><circle cx="56" cy="94" r="1.8" fill="#fff"/>`
  };

  const svg = (who, cls = "") =>
    `<svg class="dm-m ${cls}" viewBox="0 0 100 100" aria-hidden="true" style="--blink:${rand(-4, 0).toFixed(2)}s">${CHARACTERS[who]}</svg>`;
  const NAMES = { you: "Phaedra", them: "Bramble", sam: "Pip", priya: "Marlow" };
  const COLORS = { you: "#9fd0f5", them: "#c9a7f2", sam: "#8fdcae", priya: "#f0bf72" };
  window.MuseArt = { svg, NAMES, COLORS };
  for (const el of document.querySelectorAll("[data-muse]")) el.innerHTML = svg(el.dataset.muse);
})();
