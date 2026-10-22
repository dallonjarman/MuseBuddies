"""Soundtrack for the MuseBuddies brag video: music and effects written together, in A minor at 120 BPM,
cued to the video's timeline (see ../brag-plan.md). Writes a 48 kHz stereo WAV."""
import sys
import wave

import numpy as np

SR = 48000
DUR = 20.6
N = int(SR * DUR)
BEAT = 0.5  # 120 BPM
rng = np.random.default_rng(11)

music = np.zeros((N, 2))
sfx = np.zeros((N, 2))


def note(name):
    names = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((names[pitch] + 12 * (octave - 4)) / 12)


def add(bus, start, sig, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    left, right = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    bus[i : i + len(sig), 0] += sig * gain * left * 1.414
    bus[i : i + len(sig), 1] += sig * gain * right * 1.414


def tvec(dur):
    return np.arange(int(dur * SR)) / SR


def lowpass(x, cutoff):
    """Gentle FFT low-pass with a smooth roll-off."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec *= 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(spec, len(x))


def highpass(x, cutoff):
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec *= 1 / np.sqrt(1 + (cutoff / np.maximum(f, 1)) ** 4)
    return np.fft.irfft(spec, len(x))


def env(dur, attack=0.005, decay=0.3, sustain=0.0, release=0.05):
    t = tvec(dur)
    e = np.where(t < attack, t / attack, sustain + (1 - sustain) * np.exp(-(t - attack) / decay))
    rel = int(release * SR)
    if rel and rel < len(e):
        e[-rel:] *= np.linspace(1, 0, rel)
    return e


# ---------------------------------------------------------------- instruments

def pluck(freq, dur=0.35, bright=1.0):
    t = tvec(dur)
    sig = sum((0.6 / k) * np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (5 + 7 * k / bright)) for k in range(1, 6))
    return sig * env(dur, 0.003, 0.18, 0, 0.03)


def bell(freq, dur=1.2):
    t = tvec(dur)
    sig = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 6) + 0.18 * np.sin(2 * np.pi * freq * 5.4 * t) * np.exp(-t * 11)
    return sig * env(dur, 0.002, 0.45, 0, 0.1)


def pad(freqs, dur):
    t = tvec(dur)
    sig = np.zeros_like(t)
    for f in freqs:
        for det in (-0.12, 0.0, 0.12):
            ff = f * 2 ** (det / 12)
            # soft saw-ish: a few harmonics
            sig += sum((0.5 / k) * np.sin(2 * np.pi * ff * k * t + k) for k in range(1, 5))
    sig = lowpass(sig, 1400)
    a = np.minimum(1, t / 0.35)
    r = np.minimum(1, (dur - t) / 0.4)
    return sig * a * np.clip(r, 0, 1) / (len(freqs) * 3)


def bass(freq, dur):
    t = tvec(dur)
    sig = np.sin(2 * np.pi * freq * t) + 0.45 * np.sin(2 * np.pi * freq * 2 * t) + 0.2 * np.sin(2 * np.pi * freq * 3 * t)
    return np.tanh(1.4 * sig) * env(dur, 0.004, 0.22, 0.25, 0.04)


def kick(gain=1.0):
    t = tvec(0.45)
    f = 48 + 110 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 7.5) * gain


def snap():
    t = tvec(0.25)
    n = lowpass(highpass(rng.standard_normal(len(t)), 900), 3800)
    return n * np.exp(-t * 26) * 0.3 + np.sin(2 * np.pi * 220 * t) * np.exp(-t * 40) * 0.25


def hat(open_=False):
    t = tvec(0.18 if open_ else 0.06)
    n = lowpass(highpass(rng.standard_normal(len(t)), 6500), 10500)
    return n * np.exp(-t * (22 if open_ else 80)) * 0.14


def whoosh(dur=0.6, up=True):
    t = tvec(dur)
    n = rng.standard_normal(len(t))
    # sweep a band through the noise by crossfading low- and high-passed copies
    lo, hi = lowpass(n, 600), lowpass(highpass(n, 1200), 4500)
    k = t / dur if up else 1 - t / dur
    sig = lo * (1 - k) + hi * k
    shape = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    return sig * shape * 0.32


def blip(freq, dur=0.12):
    t = tvec(dur)
    return np.sin(2 * np.pi * freq * t) * np.exp(-t * 34) * env(dur, 0.002, 1, 1, 0.01)


def tick():
    t = tvec(0.03)
    return lowpass(highpass(rng.standard_normal(len(t)), 1800), 6000) * np.exp(-t * 160) * 0.5


# ---------------------------------------------------------------- the music

CHORDS = [  # one bar (2 s) each: Am, F, C, G
    ("A2", ["A3", "C4", "E4", "B4"]),
    ("F2", ["F3", "A3", "C4", "E4"]),
    ("C3", ["C4", "E4", "G4", "D5"]),
    ("G2", ["G3", "B3", "D4", "A4"]),
]

# Hook (0–3.2): a tight, slightly nervous pluck ostinato on A, getting busier with the chat.
for i in range(int(3.2 / (BEAT / 2))):
    t0 = i * BEAT / 2
    seq = ["A4", "E4", "A4", "C5", "A4", "E4", "G4", "E4"]
    add(music, t0, pluck(note(seq[i % 8]), 0.25, 0.8), 0.42 + 0.14 * (t0 / 3.2), pan=-0.25 if i % 2 else 0.25)
for i in range(6):
    add(music, i * BEAT, kick(0.6), 0.6)
for i in range(12):
    add(music, 1.0 + i * BEAT / 2, hat(), 0.35, pan=0.35)
add(music, 0, pad([note("A3"), note("E4"), note("C4")], 3.2), 0.85)
add(music, 0, bass(note("A2"), 3.1) * np.linspace(0.6, 1, int(3.1 * SR)), 0.22)
# riser into the drop
riser = whoosh(0.9, up=True)
add(sfx, 2.35, riser * np.linspace(0.2, 1, len(riser)), 0.4)

# Groove (3.2–17.8): kick, snaps on 2 and 4, hats, bass and pads over Am–F–C–G.
start, end = 3.2, 17.8
bar = 0
t0 = start
while t0 < end - 0.01:
    root, chord = CHORDS[bar % 4]
    add(music, t0, pad([note(n) for n in chord], 2.05), 0.75)
    for b in range(4):
        tb = t0 + b * BEAT
        if tb >= end:
            break
        add(music, tb, kick(1.0), 0.75)
        if b in (1, 3):
            add(music, tb, snap(), 0.45, pan=0.1)
        for h in range(2):
            add(music, tb + h * BEAT / 2, hat(open_=(h == 1 and b == 3)), 0.5, pan=0.35)
        for e8 in range(2):
            add(music, tb + e8 * BEAT / 2, bass(note(root), BEAT / 2 * 0.9), 0.38)
    # a soft pluck arpeggio on the chord tones
    arp = [chord[0], chord[1], chord[2], chord[3], chord[2], chord[1], chord[2], chord[3]]
    for k, n in enumerate(arp):
        tk = t0 + k * BEAT / 2
        if tk < end:
            add(music, tk, pluck(note(n) * 2, 0.3), 0.11, pan=-0.4 if k % 2 else 0.4)
    bar += 1
    t0 += 4 * BEAT

# Outro (17.8–20.6): the beat drops away, the pad resolves and a bell plays the motif.
add(music, 17.8, pad([note(n) for n in ["F3", "A3", "C4", "E4", "G4"]], 1.0), 0.8)
add(music, 18.8, pad([note(n) for n in ["A3", "C4", "E4", "B4"]], 1.8), 0.85)
add(music, 17.8, kick(1.0), 0.6)
for k, n in enumerate(["A5", "C6", "E6", "A6"]):
    add(music, 18.3 + k * 0.25, bell(note(n), 1.6), 0.16, pan=(-0.3 + 0.2 * k))

# ---------------------------------------------------------------- effects, in key and in the same space

PENTA = ["A5", "C6", "D6", "E6", "G6"]
# chat messages popping in (texture, kept low)
for i in range(24):
    add(sfx, 0.05 + i * 0.115, blip(note(PENTA[(i * 3) % 5]), 0.1), 0.07, pan=0.35)
add(sfx, 3.05, whoosh(0.7, up=False), 0.4)
t = tvec(1.2)
add(sfx, 3.2, np.sin(2 * np.pi * 55 * t) * np.exp(-t * 3.5), 0.35)  # soft impact under the drop
for t_ in (6.45, 11.25, 14.45, 17.65):
    add(sfx, t_, whoosh(0.45, up=True), 0.24)
for k in range(27):  # typing
    add(sfx, 7.0 + k * (1.0 / 27), tick(), 0.06, pan=-0.3)
add(sfx, 8.2, blip(note("E6"), 0.14) + blip(note("A6"), 0.14) * 0.5, 0.14, pan=-0.3)  # send
add(sfx, 8.55, blip(note("C6"), 0.12), 0.08, pan=-0.3)
for k, n in enumerate(["A5", "C6", "E6", "G6", "A6"]):  # Phaedra takes off
    add(sfx, 8.78 + k * 0.09, bell(note(n), 0.8), 0.07, pan=-0.2 + k * 0.12)
for k, n in enumerate(["E6", "A6"]):  # Bramble arrives
    add(sfx, 9.1 + k * 0.1, bell(note(n), 0.7), 0.06, pan=0.4)
for t_, n in ((9.6, "C6"), (10.0, "E6")):  # speech
    add(sfx, t_, blip(note(n), 0.12) + blip(note(n) * 1.5, 0.12) * 0.4, 0.08)
# sealing: a glassy shimmer, the packet crossing, and a chime when Bramble opens it
t = tvec(0.6)
shimmer = sum(np.sin(2 * np.pi * note(n) * t * (1 + 0.004 * k)) for k, n in enumerate(["E6", "A6", "C7", "E7"]))
add(sfx, 12.4, shimmer * np.sin(np.pi * t / 0.6) * 0.25, 0.12)
t = tvec(0.75)
sweep = np.sin(2 * np.pi * np.cumsum(note("A5") * (1 + t / 0.75)) / SR) * np.sin(np.pi * t / 0.75)
add(sfx, 12.6, sweep, 0.035)
add(sfx, 13.32, bell(note("E6"), 1.0) + bell(note("A6"), 1.0) * 0.6, 0.09, pan=0.3)
# the group gathers and talks
for k in range(4):
    add(sfx, 15.3 + k * 0.12, blip(note(["A5", "C6", "E6", "G6"][k]), 0.1), 0.06, pan=-0.45 + 0.3 * k)
for k, n in enumerate(["E6", "G6", "A6", "C7"]):
    add(sfx, 15.35 + k * 0.3, blip(note(n), 0.12), 0.08, pan=-0.45 + 0.3 * k)
# everyone agreed: a bright swell and sparkles over the confetti
t = tvec(1.4)
swell = sum(np.sin(2 * np.pi * note(n) * t) for n in ["C5", "E5", "G5", "C6"]) * np.minimum(1, t / 0.05) * np.exp(-t * 2.2)
add(sfx, 16.6, swell, 0.08)
for k in range(10):
    add(sfx, 16.62 + k * 0.07, bell(note(["C6", "E6", "G6", "C7", "E7"][k % 5]), 0.6), 0.035, pan=(k % 5 - 2) * 0.2)

# ---------------------------------------------------------------- mix: one shared room, gentle bus, soft limit

def reverb(x, seconds=1.8, mix=0.18):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * 3.2)
    ir = lowpass(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    out = np.zeros_like(x)
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    for ch in range(2):
        wet = np.fft.irfft(np.fft.rfft(x[:, ch], size) * np.fft.rfft(ir, size), size)[: len(x)]
        out[:, ch] = x[:, ch] + wet * mix
    return out


mixed = music * 0.9 + sfx * 0.75
mixed = reverb(mixed, 1.8, 0.22)
# fade the tail and a few ms at the head
mixed[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))[:, None]
fade = int(1.4 * SR)
mixed[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
mixed /= np.max(np.abs(mixed)) / 0.95
mixed = np.tanh(mixed * 1.25) / np.tanh(1.25) * 0.89  # gentle glue, peaks around -1 dBFS

out = sys.argv[1]
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mixed * 32767).astype("<i2").tobytes())
print("wrote", out, f"{len(mixed) / SR:.2f}s, peak {np.max(np.abs(mixed)):.2f}")
