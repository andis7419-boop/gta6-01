# Solmar Bay — a Make GTA 6 entry

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/r/3mkd4a85)
[![rank](https://make.fun/badge/gta6-01/andis7419-boop/gta6-01/rank.svg)](https://make.fun/r/3mkd4a85)
[![reward](https://make.fun/badge/gta6-01/andis7419-boop/gta6-01/reward.svg)](https://make.fun/r/3mkd4a85)

**Solmar Bay** is an original open-world crime game built for the
[make.fun](https://make.fun/r/3mkd4a85) bounty **gta6-01 — "Make GTA 6"**
([bounty page](https://make.fun/bounty/gta6-01)). Mara Solis, a harbour
courier in the fictional sun-soaked coastal city of Solmar Bay, owes money
to the Tide Crew and takes driving jobs from fixer Rosa Ibarra to clear the
debt — while the Solmar Bay police, the rival Harbour Kings, traffic and
pedestrians fill the streets around her.

Everything is original and procedural: the city, the cars, the people, the
story, the synthesised WebAudio sound and music. No assets, names, music or
material from any commercial game. It runs entirely offline from static
files in a desktop browser.

## What is in the game

- A procedural 8×8-block coastal city: Marina Quarter, Old Solmar, Palm Row,
  Market Mile, Harbour Yards and North Hills, with traffic, pedestrians,
  palms, lamps and a dusk light shift.
- On foot and by car: walk, sprint, hop, punch, aim and shoot; steal parked
  and traffic cars (0.8 s break-in), arcade driving with handbrake slides.
- Wanted level (0–5 stars) with police cars that pursue and ram, foot cops
  that arrest, escape timers, busted/wasted flow with fines and respawn.
- 7 chained story missions from Rosa — taxi fares, theft, tailing, a
  shootout, a timed harbour run, a getaway and a final chase — with cash
  rewards, plus free roam between jobs.
- HUD with health/armour bars, cash, wanted stars, clock, district name,
  mission objective line, message toasts, briefing cards and a live
  north-up minimap with player, traffic, police, objective and safehouse
  blips.
- Save/load (one slot, autosave every 30 sim seconds), pause menu, title
  screen over the live city, help panel and mute.
- Synthesised sound only: engine hum, two-tone sirens, gunshots, alarms,
  UI sounds and an original 8-bar music loop (C major pentatonic).

## Run it

Requires Node 22 only for the dev server and the dossier build; the game
itself is plain static files.

```sh
node serve.ts
# open http://localhost:8080 in a desktop browser
```

Or open `game/index.html` directly from the folder. Keyboard and mouse:
WASD move/drive, mouse look/aim, E enter/steal car or start a job at the
green phone blip, F punch, left mouse shoot (pistol), R reload, Space
handbrake/hop, H horn, Esc/P pause, M mute, F1 help.

## Screenshots

The four shots in `screenshots/` are real captures of the game running in
headless Chromium, staged deterministically:

| File | Scene |
|---|---|
| `1-cover.jpg` | Police chase while driving (3 stars) |
| `2-onfoot.jpg` | On foot downtown, Market Mile |
| `3-mission.jpg` | Mission m5 "Harbour Run" in progress |
| `4-title.jpg` | Title screen over the live city |

## Build the dossier

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/game/, out/screenshots/ and out/dossier.json
```

## Layout

- `game/index.html` — page, HUD DOM, import map for the vendored engine.
- `game/src/` — the game's own source, one job per file
  (`main`, `config`, `random`, `city`, `vehicles`, `traffic`,
  `pedestrians`, `police`, `missions`, `combat`, `hud`, `audio`, `save`,
  `input`, `render`, `shots`).
- `game/vendor/three.module.min.js` — vendored three.js (minified).
- `main.ts` / `vendor/makefun-game.ts` — the make.fun kit plumbing.

## License

MIT — see [LICENSE](LICENSE).
