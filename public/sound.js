// The story's score, synthesized live with Web Audio, so there are no audio files to download.
// A slow pad glides between one chord per chapter, an arpeggio plays faster the faster you scroll,
// and wind, a launch whoosh and relay static sit underneath. world.js calls update() every frame
// with the story clock (chapter index + progress) and the scroll speed.

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// One mood per chapter: the pad chord, notes the arpeggio may pick, how bright and how busy it is.
const MOODS = [
  { chord: [50, 57, 64, 66], arp: [62, 66, 69, 73, 74, 78], cutoff: 1400, density: .22, timbre: "glass", wind: .05 },  // 01 the world
  { chord: [47, 54, 57, 64], arp: [59, 62, 66, 69, 71, 74], cutoff: 1100, density: .26, timbre: "glass", wind: .04 },  // 02 a small wish
  { chord: [43, 50, 54, 61], arp: [66, 69, 73, 74, 78, 81], cutoff: 700, density: .34, timbre: "pluck", wind: .01 },   // 03 into the phone
  { chord: [52, 55, 59, 66], arp: [64, 67, 71, 74, 76, 79], cutoff: 820, density: .38, timbre: "pluck", wind: .0 },    // 04 become the Muse
  { chord: [45, 52, 57, 62], arp: [69, 71, 74, 76, 81, 83], cutoff: 1600, density: .3, timbre: "pluck", wind: .06 },   // 05 sealed and sent
  { chord: [50, 57, 61, 64], arp: [69, 73, 76, 78, 81, 85], cutoff: 2600, density: .2, timbre: "bell", wind: .07 },    // 06 above the clouds
  { chord: [55, 59, 62, 69], arp: [67, 71, 74, 79, 83, 86], cutoff: 2400, density: .24, timbre: "bell", wind: .05 },   // 07 the council
  { chord: [42, 49, 52, 59], arp: [61, 64, 66, 68, 73, 76], cutoff: 600, density: .16, timbre: "glitch", wind: .09 },  // 08 only noise
  { chord: [50, 54, 57, 64], arp: [62, 66, 69, 74, 76, 78], cutoff: 1300, density: .2, timbre: "glass", wind: .04 },   // 09 home
  { chord: [50, 57, 61, 66], arp: [69, 73, 74, 78, 81, 85], cutoff: 1000, density: .12, timbre: "bell", wind: .03 }    // epilogue
];
const MUSE_NOTES = { you: 74, them: 78, sam: 81, priya: 69 };

export class Score {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.mood = -1;
    this.s = 0;
    this.speed = 0;
    this.nextStep = 0;
    this.step = 0;
  }

  // Must run inside a click or key handler: browsers only allow audio to start from a user gesture.
  start() {
    if (!this.ctx) this.build();
    this.ctx.resume();
    this.on = true;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(.8, t, .6);
    clearTimeout(this.suspendTimer);
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 40);
  }

  stop() {
    if (!this.ctx) return;
    this.on = false;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, .25);
    clearInterval(this.timer);
    this.timer = null;
    this.suspendTimer = setTimeout(() => this.ctx.suspend(), 1500);
  }

  build() {
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // A long, soft hall made from decaying noise.
    this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 4.5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
    }
    this.verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = .55;
    this.verb.connect(wet).connect(this.master);

    // Pad: four voices, each two detuned saws and a sine, through one slowly breathing low-pass.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = .7;
    const padGain = ctx.createGain();
    padGain.gain.value = .075;
    this.padFilter.connect(padGain);
    padGain.connect(this.master);
    padGain.connect(this.verb);
    const lfo = ctx.createOscillator();
    const lfoAmt = ctx.createGain();
    lfo.frequency.value = .07;
    lfoAmt.gain.value = 260;
    lfo.connect(lfoAmt).connect(this.padFilter.frequency);
    lfo.start();
    this.voices = MOODS[0].chord.map((n, i) => {
      const g = ctx.createGain();
      g.gain.value = .25;
      const pan = ctx.createStereoPanner();
      pan.pan.value = (i / 3) * 1.2 - .6;
      g.connect(pan).connect(this.padFilter);
      const oscs = [["sawtooth", -7], ["sawtooth", 7], ["sine", 0]].map(([type, detune]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.detune.value = detune;
        o.frequency.value = midi(n);
        o.connect(g);
        o.start();
        return o;
      });
      return { oscs };
    });

    // Wind: looping noise through a band-pass whose pitch follows altitude.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = noise;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = .8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.windGain.connect(this.verb);
    src.start();

    this.arpBus = ctx.createGain();
    this.arpBus.gain.value = .9;
    this.arpBus.connect(this.master);
    const arpSend = ctx.createGain();
    arpSend.gain.value = .8;
    this.arpBus.connect(arpSend).connect(this.verb);
    this.nextStep = ctx.currentTime + .1;
  }

  // Called every frame by world.js.
  update(s, speed) {
    this.s = s;
    this.speed += (Math.min(speed, 3) - this.speed) * .08;
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const i = Math.max(0, Math.min(MOODS.length - 1, Math.floor(s)));
    if (i !== this.mood) {
      this.mood = i;
      const m = MOODS[i];
      this.voices.forEach((v, k) => v.oscs.forEach((o) => o.frequency.setTargetAtTime(midi(m.chord[k]), t, .9)));
    }
    const m = MOODS[i];
    const local = s - i;
    let cutoff = m.cutoff * (1 + this.speed * .35);
    let wind = m.wind;
    let windHz = 380 + Math.min(s, 8) * 90;
    if (i === 4) {
      // The launch: the filter and the wind rise together as you are thrown upward.
      const rise = Math.max(0, Math.min(1, (local - .3) / .4));
      cutoff *= 1 + rise * 2.5;
      wind = .05 + rise * .32 * (local < .72 ? 1 : 0);
      windHz = 400 + rise * 2600;
    }
    this.padFilter.frequency.setTargetAtTime(Math.min(cutoff, 9000), t, .4);
    this.windGain.gain.setTargetAtTime(wind * (1 + this.speed * .5), t, .3);
    this.windFilter.frequency.setTargetAtTime(windHz, t, .4);
  }

  // Look-ahead scheduler for the arpeggio: steps every 0.24 s, played with a probability that
  // grows with scroll speed, so moving through the story makes the music move too.
  schedule() {
    const ctx = this.ctx;
    while (this.nextStep < ctx.currentTime + .15) {
      const m = MOODS[Math.max(0, this.mood)];
      const p = m.density + this.speed * .3;
      if (this.step % 2 === 0 || Math.random() < p) {
        if (Math.random() < p + (this.step % 4 === 0 ? .25 : 0)) {
          const note = m.arp[(this.step * 3 + Math.floor(Math.random() * 3)) % m.arp.length];
          this.voice(m.timbre, note, this.nextStep, .5 + Math.random() * .4);
        }
      }
      if (m.timbre === "glitch" && Math.random() < .35) this.voice("static", 0, this.nextStep + Math.random() * .2, .6);
      this.step++;
      this.nextStep += .24;
    }
  }

  voice(timbre, note, at, vel = .7) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - .7;
    g.connect(pan).connect(this.arpBus);
    const f = midi(note);
    const end = at + 2.6;
    if (timbre === "static") {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3000 + Math.random() * 5000;
      g.gain.setValueAtTime(.05 * vel, at);
      g.gain.exponentialRampToValueAtTime(.0001, at + .03 + Math.random() * .05);
      src.connect(hp).connect(g);
      src.start(at, Math.random() * 2, .12);
      return;
    }
    if (timbre === "bell") {
      // Two-operator FM: a soft, slightly inharmonic bell.
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modAmt = ctx.createGain();
      car.frequency.value = f;
      mod.frequency.value = f * 3.5;
      modAmt.gain.setValueAtTime(f * 1.4, at);
      modAmt.gain.exponentialRampToValueAtTime(1, at + 1.6);
      mod.connect(modAmt).connect(car.frequency);
      car.connect(g);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(.05 * vel, at + .01);
      g.gain.exponentialRampToValueAtTime(.0001, end);
      car.start(at); mod.start(at); car.stop(end); mod.stop(end);
      return;
    }
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    o.frequency.value = f;
    if (timbre === "pluck") {
      o.type = "square";
      lp.frequency.setValueAtTime(f * 6, at);
      lp.frequency.exponentialRampToValueAtTime(f * 1.2, at + .4);
    } else {
      o.type = "triangle";
      lp.frequency.value = f * 4;
    }
    o.connect(lp).connect(g);
    const peak = (timbre === "pluck" ? .028 : .06) * vel;
    const decay = timbre === "pluck" ? .9 : 2.4;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + .012);
    g.gain.exponentialRampToValueAtTime(.0001, at + decay);
    o.start(at);
    o.stop(at + decay + .05);
  }

  // One-off accents: a Muse speaking, the copy button, saying yes to the plan.
  chime(kind, who) {
    if (!this.ctx || !this.on) return;
    const at = this.ctx.currentTime + .02;
    if (kind === "muse") {
      const n = MUSE_NOTES[who] ?? 74;
      this.voice("bell", n, at, 1);
      this.voice("bell", n + 7, at + .09, .6);
    } else if (kind === "yes") {
      [62, 66, 69, 74].forEach((n, i) => this.voice("bell", n + 12, at + i * .08, .9));
    } else {
      this.voice("glass", 81, at, .8);
    }
  }
}
