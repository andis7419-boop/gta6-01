# Solmar Bay

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/andis7419-boop/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/andis7419-boop/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

An original open-world crime game built for the [make.fun gta6-01 bounty](https://make.fun/bounty/gta6-01) — "Make GTA 6".

You are **Mara Solis**, a harbour courier in the sun-soaked coastal city of
**Solmar Bay**. You owe money to the Tide Crew. Drive, steal, run and fight
your way through seven story missions to clear the debt — or just free-roam
the city, steal cars, and lose the cops.

## Play

Open `game/index.html` in a desktop browser — the game plays fully offline
from static files, no network, no build step. Or serve it locally:

```sh
node serve.ts        # serves game/ on http://localhost:8080
```

## What's in the city

- A procedural 8×8-block coastal city: Marina Quarter, Old Solmar, Palm Row,
  Harbour Yards, North Hills, Market Mile — same city every time for a given
  seed (`?seed=N`).
- On foot and by car: stealable traffic and parked cars, arcade driving,
  traffic and pedestrians, a wanted level (0–5 stars) with police cars and
  foot cops who pursue, ram and arrest.
- Seven chained story missions with briefings, objectives, timers and cash
  rewards, plus free roam between jobs.
- On-foot combat (fists and pistol), health and armour, pickups, a HUD with
  a live minimap, a start screen, pause, and save/load (localStorage).
- Synthesised WebAudio sound: engine, sirens, gunshots and an original music
  loop. No audio, image or model files — everything is generated in code.

## Controls

| Action | Key |
|---|---|
| Move / drive | W A S D (arrows work too) |
| Sprint | Shift |
| Enter / exit / steal car | E |
| Punch | F or left mouse (on foot) |
| Aim / shoot | Right mouse to aim, left mouse to shoot |
| Reload | R |
| Handbrake (car) / hop (on foot) | Space |
| Horn | H |
| Pause | Esc or P |
| Mute | M |
| Help | F1 |

## Tech

- `game/` is plain static files: `index.html` + ES modules under
  `game/src/`, three.js vendored as one minified file
  (`game/vendor/three.module.min.js`). No build step, no npm dependency at
  runtime.
- `main.ts` (Node 22, stdlib only) copies `game/` and `screenshots/` to
  `/output` and writes `dossier.json` with the kit's `buildDossier`. Running
  it twice writes byte-identical output.
- Deterministic: seeded RNG, fixed 1/60 s simulation steps, same seed means
  the same city, traffic and mission staging.

## Credits

Built by an AI agent team for the make.fun gta6-01 competition. All city,
character, vehicle, faction and mission names are invented for this entry.
Nothing from any commercial game is used. Three.js is used under its MIT
license; this entry is MIT licensed (see `LICENSE`).
