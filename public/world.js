// The MuseBuddies story: one WebGL world the page scrolls through. A dawn valley where you text
// your Muse, the inside of your phone where you become the Muse, and the sky above the clouds
// where the Muses meet as gods and agree on a plan. Scrolling drives a "story clock"
// (chapter index + progress through that chapter) that sets the camera, the light, the music and
// the overlays. Everything is drawn procedurally; there are no models or textures to download.
// Without WebGL the page stays a readable stack of sections (see world.css "flat layout").
import * as THREE from "./vendor/three.module.min.js";
import { Score } from "./sound.js?v={{ASSET_VERSION}}";

const root = document.documentElement;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = () => innerWidth < 820;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (t) => .5 - .5 * Math.cos(Math.PI * clamp(t));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// Story-clock moments where the camera cuts: into the phone, and out of it into the sky.
const CUT_IN = 2.4, CUT_UP = 4.68;

const loader = document.querySelector(".w-loader");
const setLoad = (v) => loader?.style.setProperty("--load", v);

// ------------------------------------------------------------------ renderer (or stay flat)

const canvas = document.querySelector(".w-canvas");
let renderer;
try {
  if (new URLSearchParams(location.search).has("flat")) throw new Error("flat requested");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch {
  renderer = null;
}

if (renderer) {
  root.classList.add("w-live");
  start().catch((err) => {
    console.error(err);
    root.classList.remove("w-live");
    loader?.remove();
  });
} else {
  loader?.remove();
}

async function start() {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  THREE.ColorManagement.enabled = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, small() ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight, false);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 60, 1500);
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .5, 9000);
  scene.add(camera);
  grain();
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  setLoad(.2);
  await frame();

  // ---------------------------------------------------------------- palettes along the story

  // Each key is a point on the story clock. Sky and fog colors blend between neighbours, so the
  // light warms, cools and darkens as you travel. Two keys close together make a hard cut.
  const C = (h) => new THREE.Color(h);
  const PAL = {
    dawn:  { top: C("#24306b"), hor: C("#f6a88e"), bot: C("#3b2f57"), sun: C("#ffd9a8"), fog: C("#e9a091"), near: 60, far: 1500, sunAmt: 1, stars: 0, hemiS: C("#ffc7b0"), hemiG: C("#2e2850"), light: C("#ffd2a0") },
    phone: { top: C("#1c1250"), hor: C("#0a0722"), bot: C("#06051a"), sun: C("#9d84ff"), fog: C("#0d0a2a"), near: 10, far: 90, sunAmt: 0, stars: 0, hemiS: C("#9d84ff"), hemiG: C("#120c2a"), light: C("#b9a6ff") },
    under: { top: C("#56689c"), hor: C("#c9b8c8"), bot: C("#6d6f93"), sun: C("#ffe6c4"), fog: C("#b3abc4"), near: 40, far: 900, sunAmt: .3, stars: 0, hemiS: C("#e8dcff"), hemiG: C("#5a5a80"), light: C("#ffe2c0") },
    sky:   { top: C("#2a5cb8"), hor: C("#ffd7aa"), bot: C("#e9c0a6"), sun: C("#ffe8c2"), fog: C("#efcfb8"), near: 300, far: 4200, sunAmt: .55, stars: 0, hemiS: C("#fff3e0"), hemiG: C("#a99ccf"), light: C("#fff0d8") },
    gold:  { top: C("#28499e"), hor: C("#ffbf8a"), bot: C("#e6a98a"), sun: C("#ffd28f"), fog: C("#ebb79a"), near: 300, far: 4200, sunAmt: .75, stars: 0, hemiS: C("#ffe2c4"), hemiG: C("#9a86c4"), light: C("#ffd9a8") },
    noise: { top: C("#060b26"), hor: C("#3a4a8c"), bot: C("#20285a"), sun: C("#8fd8ff"), fog: C("#27306a"), near: 300, far: 3600, sunAmt: .35, stars: 1, hemiS: C("#7f9cff"), hemiG: C("#1a1f4a"), light: C("#a9c8ff") },
    dusk:  { top: C("#120f35"), hor: C("#ea7b86"), bot: C("#2a2048"), sun: C("#ffa77a"), fog: C("#b86a85"), near: 60, far: 1400, sunAmt: .9, stars: .8, hemiS: C("#ff9ab0"), hemiG: C("#1e1840"), light: C("#ffb08a") },
    night: { top: C("#0b0a28"), hor: C("#9c5a85"), bot: C("#1c1638"), sun: C("#ff9a7a"), fog: C("#6c4a78"), near: 60, far: 1400, sunAmt: .5, stars: 1, hemiS: C("#c58ab0"), hemiG: C("#141030"), light: C("#ff9f86") }
  };
  const PAL_KEYS = [
    [0, "dawn"], [CUT_IN - .01, "dawn"], [CUT_IN, "phone"], [CUT_UP - .01, "phone"], [CUT_UP, "under"], [4.92, "sky"],
    [6.3, "sky"], [6.95, "gold"], [7.2, "noise"], [7.85, "noise"], [8.25, "dusk"], [9.2, "dusk"], [10, "night"]
  ];
  const pal = {};
  for (const [k, v] of Object.entries(PAL.dawn)) pal[k] = v.isColor ? v.clone() : v;
  function palette(s) {
    let i = 0;
    while (i < PAL_KEYS.length - 2 && s > PAL_KEYS[i + 1][0]) i++;
    const [s0, a] = PAL_KEYS[i];
    const [s1, b] = PAL_KEYS[i + 1];
    const t = smooth(0, 1, (s - s0) / (s1 - s0 || 1));
    for (const k of Object.keys(pal)) {
      const A = PAL[a][k], B = PAL[b][k];
      if (A.isColor) pal[k].copy(A).lerp(B, t); else pal[k] = lerp(A, B, t);
    }
  }

  // ---------------------------------------------------------------- shared shader bits

  const sunDir = V(.08, .09, -1).normalize();
  const U = {
    uTop: { value: pal.top }, uHor: { value: pal.hor }, uBot: { value: pal.bot },
    uSun: { value: sunDir }, uSunCol: { value: pal.sun }, uSunAmt: { value: 1 }, uStars: { value: 0 },
    uFog: { value: pal.fog }, uFogNear: { value: 60 }, uFogFar: { value: 1500 }, uTime: { value: 0 }, uCloud: { value: 1 }
  };
  const SKY_GLSL = /* glsl */`
    uniform vec3 uTop, uHor, uBot, uSun, uSunCol; uniform float uSunAmt, uStars, uTime;
    float hash13(vec3 p) { p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
    vec3 skyColor(vec3 d) {
      float h = d.y;
      vec3 c = mix(uHor, uTop, pow(smoothstep(-.02, .55, h), .62));
      c = mix(c, uBot, smoothstep(.0, -.3, h));
      float sd = max(dot(d, uSun), 0.);
      c += uSunCol * uSunAmt * (pow(sd, 6.) * .28 + pow(sd, 48.) * .45 + smoothstep(.9994, .99975, sd) * 1.6);
      return c;
    }`;
  const FOG_GLSL = /* glsl */`uniform vec3 uFog; uniform float uFogNear, uFogFar;`;

  // ---------------------------------------------------------------- sky dome (follows the camera)

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(4000, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: /* glsl */`${SKY_GLSL}
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = skyColor(d);
          // Sun rays fanning out from the disk.
          vec3 t1 = normalize(cross(uSun, vec3(0., 1., 0.)));
          vec3 t2 = cross(t1, uSun);
          float a = atan(dot(d, t2), dot(d, t1));
          float rays = (.5 + .5 * sin(a * 13. + uTime * .05)) * (.5 + .5 * sin(a * 29. - uTime * .07));
          c += uSunCol * uSunAmt * rays * pow(max(dot(d, uSun), 0.), 7.) * .18;
          // Stars, twinkling, only high in the sky.
          vec3 p = d * 520.;
          vec3 id = floor(p);
          float r = hash13(id);
          float star = step(.9965, r) * smoothstep(.45, .0, length(fract(p) - .5)) * smoothstep(.02, .3, d.y);
          c += vec3(1., .95, .9) * star * uStars * (.6 + .4 * sin(uTime * 2. + r * 60.));
          gl_FragColor = vec4(c, 1.);
        }`
    })
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // ---------------------------------------------------------------- lights

  const hemi = new THREE.HemisphereLight(0xffffff, 0x222244, 1.1);
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
  sunLight.position.copy(sunDir).multiplyScalar(100);
  scene.add(hemi, sunLight);

  // ---------------------------------------------------------------- the valley

  const earth = new THREE.Group();
  scene.add(earth);

  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, o = 5) => { let s = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= .5; } return s; };
  const LAKE = -9;
  const height = (x, z) => {
    let h = (fbm(x * .0055 + 3.1, z * .0055 + 1.7) - .45) * 70;
    h += 30 * Math.exp(-(x * x + z * z) / (2 * 38 * 38));                       // the hill you sit on
    h -= 42 * Math.exp(-((z + 230) ** 2) / (2 * 80 * 80)) * (1 - Math.exp(-(x * x) / 4e5) * .2); // the lake basin
    h += Math.max(0, Math.abs(x) - 160) * .32 + Math.max(0, -z - 520) * .22;    // valley walls
    return h < LAKE + 1 ? h - 4 : h; // keep the lakebed well under the water so they never z-fight
  };
  const H0 = height(0, 0);

  {
    const geo = new THREE.PlaneGeometry(1800, 1800, small() ? 140 : 200, small() ? 140 : 200);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -400);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const low = C("#3e5a52"), mid = C("#6e8063"), high = C("#8f8a7a"), sand = C("#c8a48e"), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = height(x, z);
      pos.setY(i, h);
      const n = fbm(x * .05, z * .05, 2);
      tmp.copy(low).lerp(mid, clamp((h + 10) / 40 + (n - .5) * .6)).lerp(high, clamp((h - 40) / 60));
      if (h < LAKE + 2.5) tmp.lerp(sand, .7);
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo.toNonIndexed(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    ground.geometry.computeVertexNormals();
    earth.add(ground);
  }

  // Pines, scattered where the ground is neither lake nor your hilltop.
  {
    const count = small() ? 500 : 900;
    const cone = new THREE.ConeGeometry(1.7, 7, 6);
    cone.translate(0, 3.2, 0);
    const trees = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: "#2b3f3c", flatShading: true }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 20; tries++) {
      const x = (Math.random() - .5) * 1100, z = 160 - Math.random() * 1100;
      const h = height(x, z);
      if (h < LAKE + 3 || Math.hypot(x, z) < 26 || fbm(x * .012, z * .012, 2) < .47) continue;
      const k = .7 + Math.random() * 1.1;
      s.set(k, k * (.8 + Math.random() * .6), k);
      m.compose(V(x, h - .5, z), q, s);
      trees.setMatrixAt(placed++, m);
    }
    trees.count = placed;
    earth.add(trees);
  }

  // The lake mirrors the sky, with a path of sun glitter.
  {
    const lake = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 420).rotateX(-Math.PI / 2).translate(0, LAKE, -240),
      new THREE.ShaderMaterial({
        uniforms: U, transparent: false,
        vertexShader: /* glsl */`varying vec3 vW; varying float vD; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */`${SKY_GLSL}${FOG_GLSL}
          varying vec3 vW; varying float vD;
          void main() {
            vec3 v = normalize(vW - cameraPosition);
            vec2 q = vW.xz * .22;
            vec3 n = normalize(vec3(sin(q.x * 3.1 + q.y * 1.7 + uTime * .9) * .003 + sin(q.y * 5.3 - uTime * .7) * .002, 1., cos(q.x * 4.7 + q.y * 2.3 + uTime) * .003));
            n = normalize(mix(vec3(0., 1., 0.), n, 1. - smoothstep(60., 500., vD)));
            vec3 mirror = reflect(v, vec3(0., 1., 0.));
            vec3 c = skyColor(mirror) * .82;
            // Ripples only scatter the sun's glitter; the mirrored sky stays calm.
            vec3 r = normalize(reflect(v, normalize(n * vec3(4., 1., 4.))));
            float glint = pow(max(dot(r, uSun), 0.), 300.) * 2.5;
            c += uSunCol * glint * uSunAmt;
            c = mix(c, uFog, smoothstep(uFogNear, uFogFar, vD));
            gl_FragColor = vec4(c, 1.);
          }`
      })
    );
    earth.add(lake);
  }

  // Ridges behind ridges, fading into the haze.
  const ridges = [];
  for (let i = 0; i < 4; i++) {
    const shape = new THREE.Shape();
    const z = -820 - i * 380, w = 5200, base = 30 + i * 45, amp = 120 + i * 70;
    shape.moveTo(-w / 2, -300);
    for (let x = -w / 2; x <= w / 2; x += 40) shape.lineTo(x, base + (fbm(x * .0022 + i * 9, i * 3.3, 4) - .3) * amp * 1.6);
    shape.lineTo(w / 2, -300);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    mesh.position.z = z;
    mesh.renderOrder = -5 + i * -1;
    ridges.push(mesh);
    earth.add(mesh);
  }
  const ridgeDark = C("#3a3260");

  // You, sitting on the hilltop, phone in hand.
  const you = new THREE.Group();
  you.position.set(0, H0 - .15, 0);
  earth.add(you);
  const body = new THREE.MeshLambertMaterial({ color: "#2a2347" });
  const coat = new THREE.MeshLambertMaterial({ color: "#c0563a" });
  {
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.3, .55, 6, 12), coat);
    torso.position.set(0, .78, 0);
    torso.rotation.x = -.18;
    const head = new THREE.Mesh(new THREE.SphereGeometry(.21, 18, 14), body);
    head.position.set(0, 1.42, -.12);
    const hat = new THREE.Mesh(new THREE.SphereGeometry(.225, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: "#e8b04a" }));
    hat.position.copy(head.position).add(V(0, .03, 0));
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(.14, .62, 4, 8), body);
    legs.position.set(.12, .32, -.38); legs.rotation.x = Math.PI / 2.2;
    const legs2 = legs.clone(); legs2.position.x = -.12;
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.08, .42, 4, 8), coat);
    arm.position.set(.22, .92, -.3); arm.rotation.set(-1.1, 0, .35);
    const arm2 = arm.clone(); arm2.position.x = -.22; arm2.rotation.z = -.35;
    you.add(torso, head, hat, legs, legs2, arm, arm2);
    you.userData.upper = [head, hat, arm, arm2];
  }

  // The phone and its screen, drawn on a canvas so the story can change what it shows.
  const phone = new THREE.Group();
  phone.position.set(0, .95, -.62);
  phone.rotation.x = -.9;
  you.add(phone);
  phone.add(new THREE.Mesh(new THREE.BoxGeometry(.17, .33, .018), new THREE.MeshLambertMaterial({ color: "#16132a" })));
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 256; screenCanvas.height = 512;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.155, .31), new THREE.MeshBasicMaterial({ map: screenTex, fog: false }));
  screen.position.z = .0095;
  phone.add(screen);
  const glowTex = radialTexture([[0, "rgba(255,255,255,1)"], [.25, "rgba(255,255,255,.35)"], [1, "rgba(255,255,255,0)"]]);
  const phoneGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: "#a48cff", blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .55, fog: false }));
  phoneGlow.scale.set(1.4, 1.4, 1);
  phoneGlow.position.z = -.06;
  phone.add(phoneGlow);
  let screenMode = "";
  function drawScreen(mode) {
    if (mode === screenMode) return;
    screenMode = mode;
    const g = screenCanvas.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, "#2a1d6e"); grd.addColorStop(1, "#0d0a2a");
    g.fillStyle = grd; g.fillRect(0, 0, 256, 512);
    g.fillStyle = "rgba(255,255,255,.85)"; g.font = "600 18px Inter, sans-serif"; g.fillText("Phaedra", 64, 58);
    g.fillStyle = "#9fd0f5"; g.beginPath(); g.arc(36, 52, 18, 0, 7); g.fill();
    const bubble = (x, y, w, h, fill) => { g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, 18); g.fill(); };
    if (mode === "ask") {
      bubble(60, 300, 176, 74, "#7c5cff");
      g.fillStyle = "#fff"; g.font = "500 17px Inter, sans-serif";
      g.fillText("Dinner with Alex", 76, 330); g.fillText("this week?", 76, 354);
      bubble(20, 392, 150, 46, "rgba(255,255,255,.16)");
      g.fillStyle = "#fff"; g.fillText("On it ✦", 36, 421);
    } else {
      bubble(18, 220, 220, 170, "#fff8ef");
      g.fillStyle = "#d0506a"; g.font = "700 14px Inter, sans-serif"; g.fillText("THURSDAY", 38, 258);
      g.fillStyle = "#120f2e"; g.font = "400 46px 'Instrument Serif', serif"; g.fillText("7:00 pm", 36, 310);
      g.font = "500 16px Inter, sans-serif"; g.fillText("Dinner with Alex", 38, 342);
      g.fillStyle = "#2f9d68"; g.fillText("✓ Bramble confirmed", 38, 370);
    }
    screenTex.needsUpdate = true;
  }
  drawScreen("ask");
  you.updateMatrixWorld(true);
  const S = new THREE.Vector3(); screen.getWorldPosition(S);
  const N = V(0, 0, 1).applyQuaternion(screen.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const fromScreen = (d, up = 0, side = 0) => S.clone().addScaledVector(N, d).add(V(side, up, 0));

  setLoad(.45);
  await frame();

  // ---------------------------------------------------------------- inside the phone

  const P = V(0, -6000, 0);
  const inside = new THREE.Group();
  inside.position.copy(P);
  inside.visible = false;
  scene.add(inside);
  const COLS = 7, ROWS = 5;
  const FREE = new Set(["1-3", "3-3", "5-0", "6-2", "2-1", "4-4"]); // day-row
  const PRIVATE = new Set(["0-1", "2-3", "4-2", "6-4", "1-0"]);
  const THU = "3-3";
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(2.7, 1.55, .14), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), COLS * ROWS);
  const tileInfo = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const key = `${c}-${r}`;
      const home = V((c - 3) * 3.05, (2 - r) * 1.85, -.045 * ((c - 3) * 3.05) ** 2);
      tileInfo.push({ key, home, free: FREE.has(key), priv: PRIVATE.has(key), thu: key === THU, order: Math.random(), pos: home.clone() });
    }
  }
  inside.add(tiles);
  {
    const lc = document.createElement("canvas");
    lc.width = 1024; lc.height = 64;
    const g = lc.getContext("2d");
    g.font = "500 26px 'JetBrains Mono', monospace"; g.fillStyle = "rgba(255,248,239,.7)"; g.textAlign = "center";
    ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].forEach((d, i) => g.fillText(d, (i + .5) * (1024 / 7), 42));
    const label = new THREE.Mesh(new THREE.PlaneGeometry(21.35, 1.33), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lc), transparent: true, fog: false, depthWrite: false }));
    label.position.set(0, 5.4, -.4);
    inside.add(label);
  }
  const thuGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: "#ffc977", blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false }));
  thuGlow.scale.set(9, 6, 1);
  inside.add(thuGlow);
  const lockTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d");
    g.strokeStyle = "#fff"; g.lineWidth = 16; g.lineCap = "round";
    g.beginPath(); g.arc(128, 104, 46, Math.PI, 0); g.lineTo(174, 130); g.moveTo(82, 130); g.lineTo(82, 104); g.stroke();
    g.fillStyle = "#fff"; g.beginPath(); g.roundRect(60, 124, 136, 100, 20); g.fill();
    g.fillStyle = "#7c5cff"; g.beginPath(); g.arc(128, 166, 14, 0, 7); g.fill(); g.fillRect(122, 170, 12, 28);
    return new THREE.CanvasTexture(c);
  })();
  const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTex, transparent: true, opacity: 0, fog: false, depthTest: false }));
  lock.scale.set(2.4, 2.4, 1);
  lock.position.set(0, 0, 3);
  lock.renderOrder = 20;
  inside.add(lock);

  // Light streaks for the launch upward.
  const streakCount = 220;
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(streakCount * 6), 3));
  const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ color: "#d9ccff", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  streaks.frustumCulled = false;
  scene.add(streaks);
  const streakSeeds = Array.from({ length: streakCount }, () => ({ a: Math.random() * Math.PI * 2, r: 3 + Math.random() * 22, y: Math.random(), len: 4 + Math.random() * 16 }));

  setLoad(.6);
  await frame();

  // ---------------------------------------------------------------- the sky: cloud sea, puffs, Muses

  const SEA = 440;
  const sky = new THREE.Group();
  scene.add(sky);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`varying vec3 vW; varying float vD; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`${SKY_GLSL}${FOG_GLSL}
        uniform float uCloud;
        varying vec3 vW; varying float vD;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
        float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.02 + 7.3; a *= .5; } return s; }
        void main() {
          vec2 p = vW.xz * .0032 + vec2(uTime * .006, uTime * .002);
          float d = fbm(p);
          float dens = smoothstep(.34, .62, d);
          float lit = clamp((d - fbm(p + uSun.xz * .06)) * 4. + .55, 0., 1.);
          vec3 shadow = mix(uBot, uTop, .25) * .9;
          vec3 col = mix(shadow, vec3(1., .98, .95) * mix(vec3(1.), uSunCol, .45), lit);
          bool below = cameraPosition.y < vW.y;
          if (below) col = mix(uBot, shadow, .6) * .85;
          float f = smoothstep(uFogNear, uFogFar, vD);
          col = mix(col, uFog, f * .85);
          float a = mix(dens, 1., .55) * (1. - smoothstep(.75, 1., f)) * uCloud;
          gl_FragColor = vec4(col, a);
        }`
    })
  );
  sea.position.y = SEA;
  sea.renderOrder = 1;
  sky.add(sea);

  // Billowing puffs: camera-facing quads, sorted back to front so they layer like real cloud.
  // A wispy cumulus puff from noise: a soft dome with a flatter base and a ragged edge. Alpha is
  // the cloud's shape; red holds its density, which the shader uses to light the inside.
  const puffTex = (() => {
    const N = 192, c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c.getContext("2d");
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x - N / 2) / (N / 2), dy = (y - N * .56) / (N / 2);
        const r = Math.hypot(dx, dy * (dy > 0 ? 1.9 : 1.15));
        const n = fbm(x / 26 + 11, y / 26 + 7, 5);
        const a = smooth(1, .3, r + (.5 - n) * .85);
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(clamp(n * 1.4 - .1) * 255);
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
  })();
  const puffs = [];
  const addPuff = (x, y, z, size) => puffs.push({ p: V(x, y, z), size, seed: Math.random() });
  for (let i = 0; i < 70; i++) { const a = Math.random() * 6.28, r = Math.random() * 120; addPuff(Math.cos(a) * r, 395 + Math.random() * 45, 110 + Math.sin(a) * r, 40 + Math.random() * 35); }
  for (let i = 0; i < 60; i++) { const a = Math.random() * 6.28, r = Math.random() * 130; addPuff(Math.cos(a) * r, 400 + Math.random() * 45, 250 + Math.sin(a) * r, 40 + Math.random() * 35); }
  const MUSES = [
    { who: "you", at: V(10, 458, -150) },
    { who: "them", at: V(120, 462, -232) },
    { who: "sam", at: V(-70, 470, -330) },
    { who: "priya", at: V(215, 464, -345) }
  ];
  // Portrait screens see a narrow slice of sky, so the islands huddle closer together there.
  if (innerWidth < innerHeight) for (const m of MUSES) { m.at.x = 70 + (m.at.x - 70) * .5; m.at.z = -260 + (m.at.z + 260) * .7; }
  for (const m of MUSES) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 30;
      addPuff(m.at.x + Math.cos(a) * r * 1.3, m.at.y - 16 - Math.random() * 18 + (30 - r) * .25, m.at.z + Math.sin(a) * r, 34 + Math.random() * 36);
    }
  }
  for (let i = 0; i < (small() ? 120 : 220); i++) {
    const x = (Math.random() - .5) * 3400, z = -300 - Math.random() * 2600 + (Math.random() < .3 ? 2000 : 0);
    if (Math.abs(x) < 260 && z > -500 && z < 400) continue;
    addPuff(x, SEA + Math.random() * 40, z, 90 + Math.random() * 200);
  }
  const puffGeo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  puffGeo.setIndex(quad.index);
  puffGeo.setAttribute("position", quad.attributes.position);
  puffGeo.setAttribute("uv", quad.attributes.uv);
  const puffData = new Float32Array(puffs.length * 4);
  const puffSeed = new Float32Array(puffs.length);
  const puffAttr = new THREE.InstancedBufferAttribute(puffData, 4);
  const seedAttr = new THREE.InstancedBufferAttribute(puffSeed, 1);
  puffAttr.setUsage(THREE.DynamicDrawUsage);
  seedAttr.setUsage(THREE.DynamicDrawUsage);
  puffGeo.setAttribute("aPuff", puffAttr);
  puffGeo.setAttribute("aSeed", seedAttr);
  puffGeo.instanceCount = puffs.length;
  const puffMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uTex: { value: puffTex }, uRight: { value: V(1, 0, 0) }, uUp: { value: V(0, 1, 0) }, uOpacity: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec4 aPuff; attribute float aSeed;
      uniform vec3 uRight, uUp; uniform float uFogNear, uFogFar;
      varying vec2 vUv; varying float vFog, vNear, vSeed; varying vec3 vDir;
      void main() {
        float a = (aSeed - .5) * .5;
        vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy * vec2(1. + aSeed * .6, 1.);
        vec3 w = aPuff.xyz + (uRight * q.x + uUp * q.y) * aPuff.w;
        vec4 mv = viewMatrix * vec4(w, 1.);
        gl_Position = projectionMatrix * mv;
        vUv = uv; vSeed = aSeed;
        float d = -mv.z;
        vFog = smoothstep(uFogNear, uFogFar, d);
        vNear = smoothstep(aPuff.w * .15, aPuff.w * .9, d);
        vDir = normalize(w - cameraPosition);
      }`,
    fragmentShader: /* glsl */`${SKY_GLSL}${FOG_GLSL}
      uniform sampler2D uTex; uniform float uOpacity;
      varying vec2 vUv; varying float vFog, vNear, vSeed; varying vec3 vDir;
      void main() {
        vec4 tx = texture2D(uTex, vUv);
        float a = tx.a;
        float lit = clamp(.12 + vUv.y * .85 + (tx.r - .45) * .55, 0., 1.);
        vec3 shadow = mix(uBot, uTop, .3) * .95;
        vec3 col = mix(shadow, vec3(1., .985, .96), lit);
        float back = pow(max(dot(vDir, uSun), 0.), 6.);
        col += uSunCol * uSunAmt * (back * (1. - a) * 1.4 + lit * .12);
        col = mix(col, uFog, vFog * .9);
        gl_FragColor = vec4(col, a * uOpacity * vNear * (1. - vFog * .7));
      }`
  });
  const puffMesh = new THREE.Mesh(puffGeo, puffMat);
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 3;
  sky.add(puffMesh);
  const order = puffs.map((_, i) => i);
  const camPos = new THREE.Vector3();
  function sortPuffs() {
    for (const p of puffs) p.d = p.p.distanceToSquared(camPos);
    order.sort((a, b) => puffs[b].d - puffs[a].d);
    order.forEach((idx, i) => {
      const p = puffs[idx];
      puffData.set([p.p.x, p.p.y, p.p.z, p.size], i * 4);
      puffSeed[i] = p.seed;
    });
    puffAttr.needsUpdate = true;
    seedAttr.needsUpdate = true;
  }

  // The Muses, enthroned on their islands, from the same drawings as the rest of the site.
  const haloTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(128, 128, 60, 128, 128, 128);
    grd.addColorStop(0, "rgba(255,230,180,0)"); grd.addColorStop(.62, "rgba(255,230,180,.0)"); grd.addColorStop(.72, "rgba(255,236,190,.95)");
    grd.addColorStop(.8, "rgba(255,210,150,.35)"); grd.addColorStop(1, "rgba(255,200,140,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: C("#ffe7b8") }, uAmt: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform vec3 uCol; uniform float uAmt; varying vec2 vUv; void main() { float a = pow(1. - vUv.y, 1.6) * (1. - pow(abs(vUv.x * 2. - 1.), 2.)) * .22 * uAmt; gl_FragColor = vec4(uCol * a, a); }`
  });
  const museSize = 30;
  for (const m of MUSES) {
    const tex = await museTexture(m.who);
    m.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: .5, fog: false }));
    m.sprite.scale.set(museSize, museSize, 1);
    m.sprite.position.copy(m.at).add(V(0, museSize * .38, 0));
    m.sprite.renderOrder = 2;
    m.sprite.userData.who = m.who;
    m.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false }));
    m.halo.scale.set(museSize * 1.25, museSize * 1.25, 1);
    m.halo.position.copy(m.sprite.position).add(V(0, museSize * .2, -2));
    m.halo.renderOrder = 1;
    m.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: "#ffd9a0", blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, fog: false }));
    m.glow.scale.set(museSize * 3, museSize * 1.6, 1);
    m.glow.position.copy(m.at).add(V(0, 2, 0));
    m.beam = new THREE.Mesh(new THREE.CylinderGeometry(museSize * .3, museSize * .75, 420, 24, 1, true), beamMat);
    m.beam.position.copy(m.at).add(V(0, 200, 0));
    m.head = m.sprite.position.clone().add(V(0, museSize * .5, 0));
    m.foot = m.at.clone().add(V(0, -6, 0));
    m.flare = 0;
    sky.add(m.halo, m.sprite, m.glow, m.beam);
  }
  const museByWho = Object.fromEntries(MUSES.map((m) => [m.who, m]));
  const center = V(70, 462, -260);

  // Golden threads between Muses as they agree; in the relay chapter they turn to static.
  const threadMat = (color) => new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uReveal: { value: 0 }, uNoise: { value: 0 }, uCol: { value: C(color) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uReveal, uNoise; uniform vec3 uCol; varying vec2 vUv;
      float h(float x) { return fract(sin(x * 91.7) * 43758.5); }
      void main() {
        if (vUv.x > uReveal) discard;
        float pulse = .55 + .45 * sin(vUv.x * 30. - uTime * 4.);
        float tip = smoothstep(uReveal - .06, uReveal, vUv.x) * 1.5;
        vec3 gold = uCol * (pulse + tip);
        float st = step(.5, h(floor(vUv.x * 120.) + floor(uTime * 18.)));
        vec3 noise = mix(vec3(.55, .85, 1.), vec3(1.), h(floor(vUv.x * 60.) + floor(uTime * 9.))) * st * 1.2;
        vec3 c = mix(gold, noise, uNoise);
        float a = .9 * (1. - abs(vUv.y - .5) * 1.6);
        gl_FragColor = vec4(c * a, a);
      }`
  });
  const THREADS = [["you", "them", 6.1, 6.46], ["sam", "you", 6.58, 6.72], ["sam", "them", 6.62, 6.76], ["priya", "sam", 6.7, 6.82], ["priya", "you", 6.74, 6.86], ["priya", "them", 6.78, 6.9]];
  const threads = THREADS.map(([a, b, s0, s1]) => {
    const A = museByWho[a].head, B = museByWho[b].head;
    const mid = A.clone().lerp(B, .5).add(V(0, 32 + A.distanceTo(B) * .12, 0));
    const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, .55, 6, false), threadMat("#ffcf86"));
    mesh.renderOrder = 4;
    sky.add(mesh);
    return { mesh, curve, s0, s1 };
  });

  // The relay: a faint lattice around the council, and sealed packets crossing it.
  const lattice = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(360, 2)),
    new THREE.LineBasicMaterial({ color: "#8fd8ff", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  );
  lattice.position.copy(center);
  sky.add(lattice);
  const packetCount = threads.length * 16;
  const packetGeo = new THREE.BufferGeometry();
  packetGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(packetCount * 3), 3));
  const packets = new THREE.Points(packetGeo, new THREE.PointsMaterial({ color: "#c9f0ff", size: 5, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, map: glowTex }));
  packets.frustumCulled = false;
  sky.add(packets);

  setLoad(.8);
  await frame();

  // ---------------------------------------------------------------- drifting motes around the camera

  const moteCount = small() ? 500 : 1100;
  const moteGeo = new THREE.BufferGeometry();
  const mp = new Float32Array(moteCount * 3);
  for (let i = 0; i < mp.length; i++) mp[i] = Math.random();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(mp, 3));
  const moteMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uBox: { value: 120 }, uCenter: { value: V(0, 0, 0) }, uCol: { value: C("#ffe2b0") }, uSize: { value: 1 }, uAmt: { value: 1 }, uScale: { value: renderer.getPixelRatio() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime, uBox, uSize, uScale; uniform vec3 uCenter; varying float vA;
      void main() {
        vec3 drift = vec3(sin(uTime * .1 + position.y * 9.) * .02, uTime * .004, cos(uTime * .08 + position.x * 7.) * .02);
        vec3 p = fract(position + drift - uCenter / uBox + .5) - .5;
        vec3 w = uCenter + p * uBox;
        vec4 mv = viewMatrix * vec4(w, 1.);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = uSize * uScale * (110. / max(d, 1.)) * (.5 + fract(position.x * 13.7));
        vA = smoothstep(.02, .12, d / uBox) * (1. - smoothstep(.25, .5, d / uBox)) * (.4 + .6 * sin(uTime * 1.3 + position.z * 40.) * .5 + .3);
      }`,
    fragmentShader: `uniform vec3 uCol; uniform float uAmt; varying float vA; void main() { float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d) * vA * uAmt; gl_FragColor = vec4(uCol * a, a); }`
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  motes.renderOrder = 6;
  scene.add(motes);

  // ---------------------------------------------------------------- the camera's route

  // Each chapter is one or more shots. A shot is a list of [position, look-at] keys that the camera
  // glides through as the chapter progresses; a shot marked cut starts with a hard cut.
  const h = H0;
  const tileC = P.clone();
  const sh = (from, to, keys, opts = {}) => ({ from, to, keys, ...opts });
  const orbit = (r, y, a) => V(center.x + Math.sin(a) * r, y, center.z + Math.cos(a) * r);
  const SHOTS = [
    [sh(0, 1, [[V(0, 70, 300), V(0, 32, -420)], [V(-24, 56, 220), V(0, 24, -420)], [V(-12, 44, 140), V(0, 22, -320)]])],
    [sh(0, 1, [[V(-12, 44, 140), V(0, 22, -320)], [V(16, h + 11, 36), V(0, h + 2, -60)], [V(3.2, h + 3.6, 7), V(0, h + 1.2, -8)], [fromScreen(1.4, 1.35, .9), S]], { fov: [42, 38] })],
    [sh(0, CUT_IN - 2, [[fromScreen(1.4, 1.35, .9), S], [fromScreen(.5, .1, .14), S], [fromScreen(.05), S]], { fov: [38, 34], ease: (t) => t * t * (3 - 2 * t) }),
     sh(CUT_IN - 2, 1, [[P.clone().add(V(0, 0, 46)), tileC], [P.clone().add(V(5, 1.5, 26)), tileC.clone().add(V(3.5, 0, 0))]], { cut: true, fov: [60, 48] })],
    [sh(0, 1, [[P.clone().add(V(5, 1.5, 26)), tileC.clone().add(V(3.5, 0, 0))], [P.clone().add(V(-6, -1, 17)), tileC.clone().add(V(1, 0, 0))], [P.clone().add(V(1.5, .8, 13)), tileC.clone().add(V(3.5, -.5, 0))]], { fov: [48, 46] })],
    [sh(0, .34, [[P.clone().add(V(1.5, .8, 13)), tileC.clone().add(V(3.5, -.5, 0))], [P.clone().add(V(0, 0, 10)), P.clone().add(V(0, 0, 2))]], { fov: [46, 46] }),
     sh(.34, CUT_UP - 4, [[P.clone().add(V(0, 0, 10)), P.clone().add(V(0, 0, 2))], [P.clone().add(V(0, 40, 9)), P.clone().add(V(0, 140, -20))], [P.clone().add(V(0, 260, 6)), P.clone().add(V(0, 500, -30))]], { fov: [46, 78], ease: (t) => t * t }),
     sh(CUT_UP - 4, 1, [[V(0, 330, 150), V(0, 640, -60)], [V(0, 430, 128), V(0, 520, -200)], [V(0, 470, 110), V(0, 476, -220)]], { cut: true, fov: [70, 48], ease: (t) => 1 - (1 - t) ** 2 })],
    [sh(0, 1, [[V(0, 470, 110), V(0, 476, -220)], [V(10, 498, 80), V(-50, 470, -250)], [orbit(330, 494, -.12), center.clone().add(V(-140, 10, 0))]], { fov: [48, 44] })],
    [sh(0, 1, [0, .25, .5, .75, 1].map((t) => [orbit(lerp(330, 270, t), lerp(494, 488, t), lerp(-.12, .32, t)), center.clone().add(V(-140, 10, 0))]), { fov: [44, 42] })],
    [sh(0, 1, [[orbit(270, 488, .32), center.clone().add(V(-140, 10, 0))], [V(-40, 620, 260), center], [V(0, 780, 560), center.clone().add(V(0, -20, 0))]], { fov: [42, 50] })],
    [sh(0, .45, [[V(0, 780, 560), center.clone().add(V(0, -20, 0))], [V(0, 600, 360), V(0, 300, 40)], [V(0, 420, 250), V(0, 160, -200)], [V(0, 150, 230), V(0, h + 20, -260)],
      [V(-8, h + 10, 34), V(0, h + 2, -20)], [fromScreen(1.6, .9, .8), S]], { fov: [50, 40] }),
     sh(.45, .62, [[fromScreen(1.6, .9, .8), S], [fromScreen(.5, .05, .3), S]], { fov: [40, 36] }),
     sh(.62, 1, [[fromScreen(.5, .05, .3), S], [fromScreen(.44, .07, .26), S]], { fov: [36, 35] })],
    [sh(0, 1, [[fromScreen(.44, .07, .26), S], [V(-2, h + 4, 9), V(0, h + 6, -60)], [V(0, h + 26, 60), V(0, h + 60, -400)]], { fov: [40, 46] })]
  ];
  for (const shots of SHOTS) {
    for (const s of shots) {
      s.pos = new THREE.CatmullRomCurve3(s.keys.map((k) => k[0]), false, "centripetal");
      s.look = new THREE.CatmullRomCurve3(s.keys.map((k) => k[1]), false, "centripetal");
    }
  }
  const camTarget = { pos: V(0, 70, 300), look: V(0, 32, -420), fov: 42, shot: null };
  function route(s) {
    const i = clamp(Math.floor(s), 0, SHOTS.length - 1);
    const t = clamp(s - i);
    const shots = SHOTS[i];
    const shot = shots.find((x) => t >= x.from && t <= x.to) ?? shots[shots.length - 1];
    const u = (shot.ease ?? ease)((t - shot.from) / (shot.to - shot.from));
    shot.pos.getPoint(u, camTarget.pos);
    shot.look.getPoint(u, camTarget.look);
    camTarget.fov = shot.fov ? lerp(shot.fov[0], shot.fov[1], u) : 42;
    camTarget.shot = shot;
  }

  setLoad(1);
  await frame();

  // ---------------------------------------------------------------- page ↔ story

  const chapters = [...document.querySelectorAll(".w-chap")];
  const connect = document.getElementById("connect");
  const texts = chapters.map((c) => c.querySelector(".w-text"));
  const chat = document.querySelector(".w-chat");
  const msgs = [...chat.querySelectorAll(".w-msg")];
  const council = [...document.querySelectorAll(".w-council li")];
  council.forEach((li, i) => {
    const at = +li.dataset.at;
    const next = council.slice(i + 1).find((x) => x.dataset.who === li.dataset.who);
    li._in = at;
    li._out = Math.min(at + .3, next ? +next.dataset.at : 99, 6.98);
    li._outSolo = Math.min(li._out, +(council[i + 1]?.dataset.at ?? 99)); // phones: one bubble at a time
  });
  const tags = Object.fromEntries([...document.querySelectorAll(".w-tag")].map((t) => [t.dataset.who, t]));
  const hudNum = document.querySelector("[data-hud-num]");
  const hudName = document.querySelector("[data-hud-name]");
  const hudAlt = document.querySelector("[data-hud-alt]");
  const rail = document.querySelector(".w-rail");
  const hud = document.querySelector(".w-hud");
  const veil = document.querySelector(".w-veil");
  const cipher = document.querySelector("[data-cipher]");

  let bounds = [];
  function measure() {
    const y = scrollY;
    bounds = chapters.map((c) => { const r = c.getBoundingClientRect(); return { top: r.top + y, h: r.height }; });
    const r = connect.getBoundingClientRect();
    bounds.push({ top: r.top + y, h: r.height + innerHeight * .2 });
  }
  function clock(y) {
    for (let i = bounds.length - 1; i >= 0; i--) {
      if (y >= bounds[i].top) return Math.min(i + (y - bounds[i].top) / bounds[i].h, bounds.length - .001);
    }
    return 0;
  }

  // Smooth scrolling, unless the visitor asked for less motion.
  const lenis = !reduce && window.Lenis ? new window.Lenis({ lerp: .085, wheelMultiplier: .9, smoothWheel: true }) : null;
  root.style.scrollBehavior = "auto";
  if (lenis) lenis.stop();
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      enter(false);
      if (lenis) lenis.scrollTo(target, { duration: 2.4 }); else target.scrollIntoView();
      history.replaceState(null, "", a.getAttribute("href"));
    });
  }

  // ---------------------------------------------------------------- sound

  const score = new Score();
  const soundBtn = document.querySelector(".w-sound");
  const soundLabel = soundBtn.querySelector(".w-sound-label");
  const setSound = (on) => {
    if (on) score.start(); else score.stop();
    soundBtn.setAttribute("aria-pressed", String(on));
    soundBtn.setAttribute("aria-label", on ? "Turn sound off" : "Turn sound on");
    soundLabel.textContent = on ? "Sound on" : "Sound off";
    try { localStorage.setItem("mb-sound", on ? "1" : "0"); } catch { /* storage blocked */ }
  };
  soundBtn.addEventListener("click", () => setSound(!score.on));
  document.addEventListener("w:chime", (e) => score.chime(e.detail.kind));

  // ---------------------------------------------------------------- intro gate

  let entered = false;
  function enter(withSound) {
    if (entered) return;
    entered = true;
    loader.classList.add("is-gone");
    setTimeout(() => loader.remove(), 1200);
    if (withSound) setSound(true);
    lenis?.start();
  }
  loader.classList.add("is-ready");
  loader.querySelector('[data-enter="sound"]').addEventListener("click", () => enter(true));
  loader.querySelector('[data-enter="quiet"]').addEventListener("click", () => enter(false));
  let wantsSound = false;
  try { wantsSound = localStorage.getItem("mb-sound") === "1"; } catch { /* storage blocked */ }
  loader.querySelector(wantsSound ? '[data-enter="sound"]' : '[data-enter="quiet"]').focus({ preventScroll: true });
  addEventListener("wheel", () => enter(false), { once: true, passive: true });
  addEventListener("touchmove", () => enter(false), { once: true, passive: true });
  addEventListener("keydown", (e) => { if (["ArrowDown", "PageDown", " ", "End"].includes(e.key) && document.activeElement?.tagName !== "BUTTON") enter(false); });
  if (scrollY > 40 || location.hash) enter(false);

  // ---------------------------------------------------------------- pointer: parallax and tapping Muses

  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  addEventListener("pointermove", (e) => {
    pointer.x = e.clientX / innerWidth * 2 - 1;
    pointer.y = e.clientY / innerHeight * 2 - 1;
    if (s >= 5 && s < 8) document.body.classList.toggle("w-muse-hover", !!pickMuse(e));
  }, { passive: true });
  function pickMuse(e) {
    ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(MUSES.map((m) => m.sprite))[0]?.object.userData.who;
  }
  const say = document.createElement("span");
  say.className = "w-say";
  document.querySelector(".w-tags").append(say);
  let sayUntil = 0, sayWho = null;
  const HELLO = {
    you: ["I'm yours. Ask me for anything with a date in it.", "I keep your week. Only free time ever leaves."],
    them: ["Bramble here. Alex likes early dinners.", "I only share what Alex lets me."],
    sam: ["Pip! Sam's birthday is coming up.", "Dumplings. Always dumplings."],
    priya: ["Marlow. Priya's flights land late on Fridays.", "Weekends are best for Priya."]
  };
  addEventListener("click", (e) => {
    if (!(s >= 5 && s < 8) || e.target.closest("a,button,summary,input")) return;
    const who = pickMuse(e);
    if (!who) return;
    const lines = HELLO[who];
    say.innerHTML = `<b>${window.MuseArt?.NAMES[who] ?? who}</b>${lines[Math.floor(Math.random() * lines.length)]}`;
    sayWho = who;
    sayUntil = performance.now() + 2600;
    museByWho[who].flare = 1;
    score.chime("muse", who);
  });

  // ---------------------------------------------------------------- frame loop

  let s = clock(scrollY);
  let lastY = scrollY, speed = 0, lastT = performance.now(), sortTick = 0, cipherTick = 0;
  let curShot = null;
  const right = new THREE.Vector3(), up = new THREE.Vector3(), tmp = new THREE.Vector3(), proj = new THREE.Vector3();
  const tileColor = new THREE.Color(), tileMatrix = new THREE.Matrix4(), tileQ = new THREE.Quaternion(), tileS = new THREE.Vector3();
  const BUSY = C("#3a2f86"), PRIV = C("#140f38"), FREEC = C("#ffc977"), THUC = C("#fff1c9"), BASE = C("#6b5bd6");
  const chimed = new Set();

  measure();
  addEventListener("resize", () => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, small() ? 1.5 : 2));
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    moteMat.uniforms.uScale.value = renderer.getPixelRatio();
    measure();
  });
  new ResizeObserver(measure).observe(document.body);
  route(s);
  camera.position.copy(camTarget.pos);
  const look = camTarget.look.clone();

  function place(el, p, dy, w, hgt) {
    proj.copy(p).project(camera);
    if (proj.z > 1) return false;
    const x = (proj.x * .5 + .5) * innerWidth, y = (-proj.y * .5 + .5) * innerHeight;
    const left = clamp(x - w / 2, 12, innerWidth - w - 12);
    el.style.transform = `translate3d(${left.toFixed(1)}px, ${(y - hgt - dy).toFixed(1)}px, 0)`;
    return x > -50 && x < innerWidth + 50 && y > 60 && y < innerHeight + 50;
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (document.hidden) return;
    const dt = Math.min((now - lastT) / 1000, .1);
    lastT = now;
    lenis?.raf(now);
    const y = lenis ? lenis.animatedScroll : scrollY;
    speed = lerp(speed, Math.abs(y - lastY) / Math.max(dt, .001) / innerHeight, .15);
    lastY = y;
    s = clock(y);
    const time = reduce ? 4 : now / 1000;
    U.uTime.value = time;

    // Camera: follow the route with a little lag, snapping on cuts.
    route(reduce ? Math.floor(s) + .5 : s);
    if (camera.aspect < 1) {
      // Portrait screens see a narrow slice of the world: widen the lens, and centre the council
      // (on wide screens it sits right of the headline).
      camTarget.fov = Math.min(camTarget.fov * (1 + (1 - camera.aspect) * .75), 95);
      const sky = smooth(4.8, 5.1, s) * (1 - smooth(7.9, 8.2, s));
      camTarget.look.x += 110 * sky;
      camTarget.look.y -= 22 * sky;
      camTarget.pos.sub(camTarget.look).multiplyScalar(1 + (1 - camera.aspect) * .35 * sky).add(camTarget.look);
    }
    const cut = camTarget.shot !== curShot && camTarget.shot?.cut;
    curShot = camTarget.shot;
    const k = cut || reduce ? 1 : 1 - Math.exp(-dt * 7);
    camera.position.lerp(camTarget.pos, k);
    look.lerp(camTarget.look, k);
    camera.fov = lerp(camera.fov, camTarget.fov, k);
    camera.lookAt(look);
    if (!reduce) {
      pointer.sx = lerp(pointer.sx, pointer.x, .05);
      pointer.sy = lerp(pointer.sy, pointer.y, .05);
      camera.rotateY(-pointer.sx * .035);
      camera.rotateX(-pointer.sy * .025);
    }
    const nearPhone = camera.position.distanceTo(S);
    camera.near = clamp(nearPhone * .25, .01, .5);
    // Right at the phone, your own head and arms would fill the frame: let the camera see past them.
    for (const part of you.userData.upper) part.visible = nearPhone > .9;
    phoneGlow.material.opacity = .55 * smooth(.7, 1.6, nearPhone);
    camera.updateProjectionMatrix();
    camPos.copy(camera.position);
    dome.position.copy(camera.position);

    // Light and air.
    palette(s);
    const inPhone = s >= CUT_IN && s < CUT_UP;
    inside.visible = inPhone;
    earth.visible = sky.visible = !inPhone;
    U.uSunAmt.value = pal.sunAmt;
    U.uStars.value = pal.stars;
    U.uFogNear.value = pal.near;
    U.uFogFar.value = pal.far;
    hemi.color.copy(pal.hemiS);
    hemi.groundColor.copy(pal.hemiG);
    sunLight.color.copy(pal.light);
    scene.fog.color.copy(pal.fog);
    scene.fog.near = pal.near;
    scene.fog.far = pal.far;
    const cloudAmt = smooth(150, 380, camera.position.y);
    U.uCloud.value = cloudAmt;
    puffMat.uniforms.uOpacity.value = smooth(150, 340, camera.position.y);
    sea.visible = cloudAmt > 0;
    ridges.forEach((r, i) => r.material.color.copy(ridgeDark).lerp(pal.hor, .35 + i * .17).lerp(pal.fog, .15));

    // The phone in your hand: the ask on the way in, the plan on the way home.
    drawScreen(s > 8.4 ? "plan" : "ask");
    phoneGlow.material.color.set(s > 8.3 ? "#ffc977" : "#a48cff");

    // Inside the phone: the week as tiles, free time lighting up, then sealed into one message.
    if (inPhone) {
      const light = smooth(3.05, 3.75, s);
      const seal = smooth(4.02, 4.32, s);
      const rise = smooth(4.34, 4.66, s);
      tileInfo.forEach((t, i) => {
        const on = t.free && light > t.order * .8;
        tileColor.copy(t.priv ? PRIV : BUSY);
        if (s < 3.05) tileColor.lerp(BASE, .35 * (1 - smooth(2.5, 3.05, s)));
        if (on) tileColor.copy(FREEC).multiplyScalar(.75 + .25 * Math.sin(time * 2 + i));
        if (t.thu && light > .55) tileColor.copy(THUC).multiplyScalar(1 + .15 * Math.sin(time * 4));
        tiles.setColorAt(i, tileColor);
        const wobble = reduce ? 0 : Math.sin(time * .6 + t.home.x * .3) * .12;
        t.pos.copy(t.home).add(tmp.set(0, wobble, 0));
        t.pos.lerp(tmp.set((t.order - .5) * .4, (t.order - .5) * .25, 2 + t.order * .2), seal);
        t.pos.y += rise * 280;
        const k2 = lerp(1, .32, seal);
        tileS.set(k2, k2, 1);
        tileMatrix.compose(t.pos, tileQ, tileS);
        tiles.setMatrixAt(i, tileMatrix);
      });
      tiles.instanceMatrix.needsUpdate = true;
      tiles.instanceColor.needsUpdate = true;
      const thu = tileInfo.find((t) => t.thu);
      thuGlow.position.copy(thu.pos);
      thuGlow.material.opacity = smooth(3.4, 3.8, s) * (1 - seal) * (.7 + .2 * Math.sin(time * 4));
      lock.position.set(0, rise * 280, 3.2);
      lock.material.opacity = smooth(4.2, 4.32, s);
      const sc = 2.4 * (1 + smooth(4.2, 4.3, s) * .2 - smooth(4.3, 4.36, s) * .2);
      lock.scale.set(sc, sc, 1);
    }

    // Streaks while you are thrown upward.
    const streakAmt = smooth(4.36, 4.5, s) * (1 - smooth(CUT_UP - .05, CUT_UP, s)) + smooth(CUT_UP, CUT_UP + .03, s) * (1 - smooth(4.74, 4.86, s)) * .6;
    streaks.material.opacity = streakAmt * .8;
    streaks.visible = streakAmt > 0;
    if (streaks.visible) {
      const arr = streakGeo.attributes.position.array;
      streakSeeds.forEach((q, i) => {
        q.y = (q.y + dt * (1.4 + speed * 2)) % 1;
        const yy = camera.position.y + 60 - q.y * 120;
        const x = camera.position.x + Math.cos(q.a) * q.r, z = camera.position.z + Math.sin(q.a) * q.r - 6;
        arr.set([x, yy, z, x, yy - q.len * (1 + speed), z], i * 6);
      });
      streakGeo.attributes.position.needsUpdate = true;
    }

    // Above the clouds: halos, beams and name tags as the Muses wake; threads as they agree.
    const awake = smooth(5.05, 5.5, s) * (1 - smooth(8.2, 8.45, s));
    beamMat.uniforms.uAmt.value = awake * (1 - smooth(7.1, 7.5, s) * .7);
    MUSES.forEach((m, i) => {
      const own = smooth(5.1 + i * .08, 5.35 + i * .08, s) * (1 - smooth(8.2, 8.45, s));
      m.flare = Math.max(0, m.flare - dt * .6);
      const pulse = reduce ? 0 : Math.sin(time * 1.4 + i) * .06;
      m.halo.material.opacity = own * (.75 + pulse) + m.flare * .5;
      m.halo.material.rotation = reduce ? 0 : time * .1 * (i % 2 ? 1 : -1);
      const hs = museSize * (1.25 + m.flare * .2);
      m.halo.scale.set(hs, hs, 1);
      m.glow.material.opacity = own * .55 + m.flare * .4;
      if (!reduce) m.sprite.position.y = m.at.y + museSize * .38 + Math.sin(time * .8 + i * 1.7) * .8;
      const tag = tags[m.who];
      const showTag = s > 5.25 && s < (innerWidth < 560 ? 6.02 : 7.15);
      tag.classList.toggle("is-on", showTag);
      if (showTag) place(tag, m.foot, -6, tag._w ??= tag.offsetWidth, 0);
    });
    threads.forEach((t) => {
      t.mesh.material.uniforms.uReveal.value = smooth(t.s0, t.s1, s) * (1 - smooth(8.2, 8.4, s));
      t.mesh.material.uniforms.uNoise.value = smooth(7.05, 7.3, s);
      t.mesh.visible = t.mesh.material.uniforms.uReveal.value > 0;
    });
    const relay = smooth(7.1, 7.4, s) * (1 - smooth(7.9, 8.2, s));
    lattice.material.opacity = relay * .22;
    lattice.rotation.y = time * .02;
    packets.material.opacity = relay;
    if (relay > 0) {
      const arr = packetGeo.attributes.position.array;
      threads.forEach((t, ti) => {
        for (let j = 0; j < 16; j++) {
          const u = (j / 16 + time * (.05 + ti * .01)) % 1;
          t.curve.getPoint(u, tmp);
          arr.set([tmp.x, tmp.y, tmp.z], (ti * 16 + j) * 3);
        }
      });
      packetGeo.attributes.position.needsUpdate = true;
    }

    // What the Muses say to each other.
    council.forEach((li) => {
      const on = s >= li._in && s < (innerWidth < 560 ? li._outSolo : li._out);
      li.classList.toggle("is-on", on);
      if (on) {
        const m = museByWho[li.dataset.who];
        place(li, m.head, 14, li._w ??= li.offsetWidth, li._h ??= li.offsetHeight);
        if (!chimed.has(li)) { chimed.add(li); score.chime("muse", li.dataset.who); }
      } else if (s < li._in) {
        chimed.delete(li);
      }
    });
    const sayOn = sayWho && now < sayUntil && s >= 5 && s < 8;
    say.classList.toggle("is-on", !!sayOn);
    if (sayOn) place(say, museByWho[sayWho].head, 14, say.offsetWidth, say.offsetHeight);

    // Puffs: face the camera, sorted every few frames.
    camera.matrixWorld.extractBasis(right, up, tmp);
    puffMat.uniforms.uRight.value.copy(right);
    puffMat.uniforms.uUp.value.copy(up);
    if (sky.visible && (sortTick++ % 4 === 0)) sortPuffs();

    // Motes: pollen in the valley, sparks inside the phone, glitter in the sky.
    moteMat.uniforms.uCenter.value.copy(camera.position);
    const alt = camera.position.y;
    if (inPhone) { moteMat.uniforms.uBox.value = 40; moteMat.uniforms.uCol.value.set("#b6a2ff"); moteMat.uniforms.uSize.value = .5; }
    else if (alt > 300) { moteMat.uniforms.uBox.value = 260; moteMat.uniforms.uCol.value.copy(s > 7 && s < 8 ? C("#9fe2ff") : C("#fff3d6")); moteMat.uniforms.uSize.value = 2.2; }
    else { moteMat.uniforms.uBox.value = 120; moteMat.uniforms.uCol.value.set("#ffe2b0"); moteMat.uniforms.uSize.value = 1.2; }
    moteMat.uniforms.uSize.value *= camera.near < .1 ? .2 : 1;

    // Flashes on the cuts, and white-out mist while passing through the cloud layer.
    const flashIn = 1 - Math.min(Math.abs(s - CUT_IN) / .045, 1);
    const flashUp = 1 - Math.min(Math.abs(s - CUT_UP) / .035, 1);
    const mist = inPhone ? 0 : clamp(1 - Math.abs(alt - (SEA + 5)) / 24) * .9;
    const veilA = Math.max(flashIn, flashUp, mist);
    veil.style.opacity = veilA.toFixed(3);
    veil.style.background = flashIn > flashUp && flashIn > mist ? "#cdbcff" : "#fff6ee";

    // HUD, rail, chat and text.
    const ci = clamp(Math.floor(s), 0, 8);
    hudNum.textContent = String(ci + 1).padStart(2, "0");
    hudName.textContent = chapters[ci].dataset.name;
    hudAlt.textContent = inPhone ? "INSIDE YOUR PHONE" : `ALT +${String(Math.max(0, Math.round((alt + 22) * 9.4))).padStart(4, "0")} M`;
    rail.style.setProperty("--p", (s / bounds.length).toFixed(4));
    hud.classList.toggle("is-done", s > 9.2);
    rail.classList.toggle("is-done", s > 9.2);

    chat.classList.toggle("is-on", s > 2.44 && s < 4.4);
    const shown = msgs.filter((m) => s >= +m.dataset.at);
    msgs.forEach((m) => {
      m.classList.toggle("is-on", s >= +m.dataset.at);
      m.classList.toggle("is-old", innerWidth < 560 && shown.length - shown.indexOf(m) > 2 && shown.includes(m));
    });

    chapters.forEach((c, i) => {
      const b = bounds[i];
      const u = clamp((y - b.top) / Math.max(b.h - innerHeight, 1));
      const fadeIn = i === 0 ? 1 : smooth(.0, .16, u);
      const fadeOut = 1 - smooth(.84, .99, u);
      const vis = y + innerHeight > b.top && y < b.top + b.h ? fadeIn * fadeOut : 0;
      texts[i].style.opacity = vis.toFixed(3);
      texts[i].style.transform = reduce ? "" : `translate3d(0, ${((1 - fadeIn) * 36 - (1 - fadeOut) * 24).toFixed(1)}px, 0)`;
    });

    if (cipher && s > 7 && s < 8 && now > cipherTick) {
      cipherTick = now + 90;
      const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      let out = "";
      for (let i = 0; i < 132; i++) out += A[Math.floor(Math.random() * 64)];
      cipher.textContent = out;
    }

    score.update(s, speed);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ helpers

function radialTexture(stops) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Rasterizes one of the shared Muse drawings (muses.js) into a texture for the sky.
function museTexture(who) {
  return new Promise((resolve) => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const tex = new THREE.CanvasTexture(c);
    const art = window.MuseArt?.svg(who);
    if (!art) { resolve(tex); return; }
    const svg = art
      .replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"')
      .replace(/<path class="dm-happy"[^>]*\/>/g, "");
    const img = new Image();
    img.onload = () => { c.getContext("2d").drawImage(img, 0, 0, 512, 512); tex.needsUpdate = true; resolve(tex); };
    img.onerror = () => resolve(tex);
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

// Film grain: one small noise tile, animated in CSS.
function grain() {
  const c = document.createElement("canvas");
  c.width = c.height = 160;
  const g = c.getContext("2d");
  const d = g.createImageData(160, 160);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  document.documentElement.style.setProperty("--w-noise", `url(${c.toDataURL()})`);
}
