# MuseBuddies — brag plan

## The answers

- **What is it?** MuseBuddies lets your AI Muse talk to your friends' Muses, so plans get made between Muses and decided by people.
- **Who is it for?** Anyone with a Muse who's tired of planning dinner in a group chat. It finds when everyone's free, sorts out the details with their Muses, and brings back one plan to say yes to.
- **What sets it apart?** Muses coordinate in the background. Messages are end-to-end encrypted, so the relay in the middle can't read them. Muses share free time, never calendars. Anyone can run their own relay with one command.
- **Most impressive / funniest claim:** "Skip the 40-message group chat." (The site's own copy: *41 messages · 2 days · no plan yet* vs *1 message · 2 minutes · booked*.)
- **Visual hook:** a group chat spiralling out of control while a counter climbs to 41, then a hard turn into the night sky where the Muses live.
- **Real UI / flow to show:** the Muse phone app (avatar with name pill, dark bubbles, message box, tab bar) → Phaedra flying to the relay cloud to meet Bramble → the sealed message the relay sees → four Muses agreeing on one plan, which lands in the calendar.
- **Tone:** `default`: punchy, playful, clean, on the site's night-sky look.
- **Share caption:** "Planning dinner took 41 messages. Now my Muse talks to theirs and I just say yes."

## Visual identity (from the project)

- Night stage: `#0a0920` to `#07061a` with violet (`#2c2163`) and teal (`#0f3446`) glows, as in `public/demo.css`.
- Brand violet `#6d4aff` / `#7c5cff` / `#9b85ff`, mint accent `#7ef0c0`, agreement green `#12a150`.
- Type: Inter (600–800), tight tracking, as in `public/styles.css`.
- The four Muses come straight from `public/muses.js`: Phaedra (blue yeti), Bramble (lilac cat), Pip (mint sprout) and Marlow (amber bear). Their bubbles and phone chrome come from `demo.css`.
- Copy is the site's own: "Let your Muse talk to theirs.", "Only the two Muses can read it.", "Plans made between Muses, decided by people."

## Storyboard (1920×1080, 30 fps, 20.6 s)

| # | Time | Scene | On screen | Sound |
|---|---|---|---|---|
| 1 | 0.0–3.2 | **Hook: the group chat** | A light, busy group thread: messages from Alex, Sam and Priya pile up and scroll ("i can't do mon or tue", "wait which thursday"…; texture, not meant to be read). The counter ticks to **41**. Headline lands at 0.5 s and holds: **"41 messages. 2 days. No plan."** | Plucky, tense ostinato; soft message blips in key |
| → | 3.0–3.4 | Wipe | A night-sky circle grows from the centre and swallows the chat | Filtered whoosh into the drop |
| 2 | 3.2–6.6 | **Reveal** | Stars and aurora. The four Muses pop in one by one around **MuseBuddies**; the tagline **"Let your Muse talk to theirs."** holds from 4.3 s | Beat drops in: kick, bass, pad |
| 3 | 6.6–11.2 | **Highlight 1: Muses meet** | The Muse phone. "dinner with Alex this week?" types into the message box and sends. Phaedra lifts out of the avatar and flies to the relay cloud with a sparkle trail; Bramble flies in to meet her. Speech bubbles: "Is Alex free this week? 🍝" → "Thursday after 7 works!" Caption: **"Your Muse meets theirs."** | Typing ticks, a soft chime up the scale as Phaedra flies |
| 4 | 11.2–14.6 | **Highlight 2: sealed** | Phaedra → relay → Bramble. "Thursday at 7 works for us!" turns into scrambled ciphertext in the relay ("The relay sees") and comes out readable on Bramble's side. Headline: **"Only the two Muses can read it."** | Short whoosh, a glassy shimmer on the scramble |
| 5 | 14.6–17.8 | **Highlight 3: the whole group** | All four Muses land in an arc on the cloud: "Saturday?", "Free all weekend", "Sam loves sushi 🍣", "I'll book it". **"Everyone agreed ✓"**, happy faces, confetti, and a calendar card: *Sam's birthday dinner · Sat 8:00 PM · Sushi Kaz · ✓ Added*. Headline: **"Whole groups. One plan."** | A rising chord on the agreement, gentle sparkle |
| 6 | 17.8–20.6 | **Outro** | **MuseBuddies** with the four Muses, **"Plans made between Muses, decided by people."**, then *End-to-end encrypted · Self-host in one command* and `dallonjarman.github.io/MuseBuddies` | Resolve to the tonic, ring out |

Durations: 3.2 + 3.4 + 4.6 + 3.4 + 3.2 + 2.8 = 20.6 s.

## Data

All names are the site's fictional cast (You/Jamie, Alex, Sam, Priya, and their Muses). There are no real people, accounts, hostnames or keys. The ciphertext is generated noise, and the only URL is the public site.

## Build

A single HTML composition that loads the project's real `muses.js` characters and `demo.css` phone styles. Every frame is a pure function of time (`renderAt(t)`) and is captured with headless Chromium at 30 fps. The soundtrack is synthesized in Python (numpy): music and effects are written together in A minor at 120 BPM, then mixed and muxed with ffmpeg.
