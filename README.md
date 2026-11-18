# Solmar Bay

[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/andis7419-boop/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/andis7419-boop/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

**Solmar Bay** is an original open-world crime game built for the
[make.fun "Make GTA 6" bounty](https://make.fun/bounty/gta6-01) (gta6-01):
a sun-soaked fictional coastal city you can explore on foot and by car.
Walk the streets or steal a car and drive; outrun the police as your
wanted level rises, take on story missions, fight on foot, and save your
progress. Traffic and pedestrians fill the streets, the HUD shows your
cash, health and wanted stars beside a live minimap, and the whole city
is procedural and deterministic — the same seed builds the same streets,
traffic and missions. Everything in it — the city, characters, vehicles,
story, art, sound and music — is original, made for this entry. No
material from any commercial game.

Solmar Bay is a harbour city: a marina and beachfront,
downtown, offices, shops, and streets between them all
generated fresh from the seed. The sun moves over the city all day.

Referral code: `3mkd4a85`

## Play

Serve `game/` with any static file server, or use the dev server:

```sh
node serve.ts
```

Then open <http://localhost:8080>. The game runs offline in a desktop
browser: plain static files under `game/`, no build step, no network
requests. Add `?seed=N` to the URL to play a different city; the default
seed is 1. Progress autosaves to the browser (one slot, Continue on the
title screen loads it).

## How to play

You start on foot at the Marina safehouse. Earn cash from story missions —
drive to the marker, meet the contact, do the job — and from lifting cars
off the street. Crime raises your wanted level and brings the police;
break line of sight and the heat cools off, get busted or wasted and you
lose your take and your ride. Missions pay out, unlock the next job;
the briefing card states the objective. The pistol (once owned)
gives you a ranged option, with very limited ammo. The minimap shows you, the
mission marker, and closing police. Loading a save respawns you on foot
at the Marina safehouse with cash, missions and flags intact.

## Controls

| Action | Binding |
| --- | --- |
| Move / drive | W A S D (arrow keys work too) |
| Sprint (on foot) | Shift |
| Mouse look / aim | Mouse (pointer locked) |
| Punch | F or left mouse |
| Aim | Right mouse (hold) |
| Shoot | Left mouse (aiming, pistol equipped) |
| Reload | R |
| Enter / exit / steal car | E (near a car, <= 3 m) |
| Handbrake / jump | Space |
| Horn (in car) | H |
| Pause | Esc or P |
| Mute | M |
| Help | F1 |
| Start mission / confirm | Enter (or E at a marker) |
| Skip briefing | Enter |

## Screenshots

Four real captures in `screenshots/` (first by name is the cover):

- `1-cover.jpg` — police chase while driving, wanted stars, minimap, HUD.
- `2-onfoot.jpg` — on foot downtown, pedestrians, stealable cars.
- `3-mission.jpg` — mission in progress, objective marker, briefing text.
- `4-title.jpg` — title screen over the live city.

## Entry

`main.ts` (Node 22, standard library only) hands the game in: it copies
`game/` and `screenshots/` to `/output` (`MAKEFUN_OUTPUT_DIR` outside
the grader) and writes `/output/dossier.json` with `buildDossier` from
the vendored make.fun library (`vendor/makefun-game.ts`).

## Credits

Solmar Bay was built by an AI agent team for the make.fun gta6-01
bounty. The 3D engine is three.js 0.170.0, vendored under
`game/vendor/three.module.min.js`. MIT licensed — see LICENSE.
