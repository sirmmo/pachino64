# Capitan Pachino 64

A 3D collect-the-stars platformer in the browser. Capitan Pachino, a tomato pirate, returns to the
Garden Isle to find it overrun: **vegetables are friends, steaks and fish are enemies**.
Recover the 7 Golden Stars of the Garden Isle, then step through the Star Gate to Isola Brace
for 5 more, through the Ice Gate to Mare Surgelato for another 5, through the Candy Gate
to Dolceterra for 5 more, and finally through the Kitchen Gate to La Grande Cucina for the last 5:
27 stars in all.

**Play:** https://sirmmo.github.io/pachino64/

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | `WASD` | Left stick |
| Camera | Mouse (click to capture), `←` `→` `↑` `↓`, wheel to zoom | Right stick |
| Jump (chain up to 3) | `Space` | A |
| Crouch / ground pound (in the air) | `Shift` | Shoulder buttons |
| Sword slash | `J` or click | X / B |
| Talk | `E` | Y |
| Pause / mute | `Esc` / `M` | Start |

On phones and tablets, on-screen controls appear: left thumb moves, dragging elsewhere turns the camera,
and there are JUMP, SLASH and DOWN (crouch / ground pound) buttons. Landscape works best.

Crouch + jump while running is a long jump, crouch + jump while standing is a backflip,
and jumping again right after hitting a wall in the air is a wall kick.

## World 1: Garden Isle

1. King Steak of Mount Grill
2. Top of the Sky Carrot Tower
3. Eight Red Peppers
4. The Lost Cherry Tomatoes
5. Big Catch at Lake Lattuga
6. 100 Coin Feast
7. Steak Roundup

## World 2: Isola Brace

Collecting all seven stars wakes the Star Gate on the beach just south of the starting point.
It leads to Isola Brace, a volcanic isle in a sea of hot sauce (falling in burns and bounces you
back out). The gate on the other side leads home again.

8. Don Prosciutto of Vulcano Ragù
9. Across the Sizzling Sauce
10. Top of the Spiedino Spire
11. Eight Sunny Lemons
12. Rack of Ribs Roundup

Racks of ribs are immune to the sword: stomp them, ground pound them or knock them into the sauce.

## World 3: Mare Surgelato

Collecting the five stars of Isola Brace wakes the Ice Gate on its arrival dock. It leads to
Mare Surgelato, the Frozen Sea: blue ice is slippery, cracked floes break under your feet, and
you can swim, but the freezing water drains health.

13. Il Tonno Padrino of the Frozen Trawler
14. Top of the Cono Lighthouse
15. The Sushi Belt Run
16. Eight Snow Peas
17. Thaw the Frozen Villagers

Sushi rolls aim and then roll in a straight line, so they can be baited off the ice. Frozen fish
wear an ice block: the first hit (slash, stomp or ground pound) cracks it, the second finishes them.
Frozen villagers are freed by slashing their block. Il Tonno Padrino is hurt by a slash or a stomp
while he flops on the ice.

## World 4: Dolceterra

Collecting the five stars of Mare Surgelato wakes the Candy Gate on its arrival floe. Dolceterra,
the Sugar Isles, floats in melted chocolate: you sink in it, so hop out at once. Jelly pads bounce
you (hold jump for more height) and caramel is sticky.

18. Barone Tacchino of the Torta Reale
19. The Great Jelly Jump
20. Biscuit Rafts to Isola Bignè
21. Eight Wild Strawberries
22. Meatball Roundup

Meatballs never stop hopping while they chase you, and will follow you off an edge. Barone Tacchino
hops three times, sending a shockwave on each landing, and is then out of breath.

## World 5: La Grande Cucina

Collecting the five stars of Dolceterra wakes the Kitchen Gate on its arrival biscuit. In the
Giant Kitchen you are tiny: falling off the counter costs health, hobs burn while they glow red,
knives chop on a rhythm, steam lifts you, and the sink is deep enough to swim in.

23. Il Mannarone, the Chef's Cleaver
24. Top Shelf of the Fridge
25. Across the Hot Hobs
26. Eight Crunchy Pickles
27. The Spice Rack Summit

Burgers take two hits (the bun flies off first). Il Mannarone hovers over you and chops: step out
from under his shadow, and hit him with the sword while he is stuck in the board.

## Achievements

15 achievements (2 secret) and 3 stats, kept by the openachievements library: saved in the
browser, and reported to Wavedash when the game runs there.

- **The list**: the *Achievements* button on the title and pause screens, `L` on the keyboard,
  or Select/Back on a gamepad. `Esc` (or B/Start/Select) closes it.
- **The manifest**: `achievements.json` at the root (titles, descriptions, stats, thresholds, the
  Wavedash game id). The library is vendored in `vendor/openachievements/` and started in `index.html`.
- **Adding one**: add it to `achievements.json`. If it is a count, give it a `stat` and a
  `threshold` (`golden_stars` is a best, set from the saved stars; `coins_collected` and
  `enemies_defeated` count up). Otherwise call `ach.unlock('ID')` where it happens in `js/main.js`
  (the `ach` helper reports coins in chunks of 10). Check the
  manifest with `cargo run -p openachievements-cli -- check achievements.json` in the
  openachievements repository, and give Wavedash the JSON from its `wavedash` command (Developer
  Portal › Achievements › Import JSON).
- **Badge Collector**: from the list a player can collect the achievements as badges on
  [badgecollector.org](https://badgecollector.org) (an email, hashed in the browser; only the hash
  is kept and sent). The game is the public client `pachino64` there, allowed from ingmmo.com,
  itch.io and Wavedash; a new achievement needs its badge too: `openachievements badgecollector
  achievements.json --name "Capitan Pachino 64" --origin … -o <badgecollector checkout>`, then a
  pull request there.

## Run locally

It is a static site with no build step:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Layout

- `index.html` – page, HUD and screens
- `js/main.js` – engine, physics, player, enemies, friends, level
- `js/audio.js` – synthesized sound effects and music (WebAudio)
- `models/pachino.glb` – Capitan Pachino, simplified from the source model in `sample_*.zip`
- `models/food`, `models/platformer` – Kenney Food Kit and Platformer Kit models
- `achievements.json` – achievements and stats (see Achievements)
- `vendor/` – three.js r160, openachievements (`vendor/openachievements/`)

## Credits

- Food Kit and Platformer Kit by [Kenney](https://kenney.nl) (CC0)
- [three.js](https://threejs.org) (MIT)
- openachievements (MIT, `vendor/openachievements/LICENSE-MIT`)

## Publishing on Wavedash

Capitan Pachino 64 is published on [Wavedash](https://wavedash.com)
([docs](https://docs.wavedash.com)) from `wavedash.toml`, at the root.

1. **Create the game** in the Wavedash Developer Portal, or with the CLI (`curl -fsSL
   https://wavedash.com/cli/install.sh | sh`, `wavedash auth login`, then `wavedash project create
   --title "Capitan Pachino 64" --team-id <TEAM_ID>`).
2. **Set its id**: `game_id` in `wavedash.toml`, or, to keep it out of the repository,
   `WAVEDASH_GAME_ID_PACHINO64` (or `WAVEDASH_GAME_ID`) in the environment, and the repository
   variable `WAVEDASH_GAME_ID_PACHINO64` (Settings › Secrets and variables › Actions › Variables).
3. **Upload a build**: `sh tools/wavedash.sh` assembles the game into `_wavedash/` the way the Pages
   workflow does (not `src_model/`) and, with the CLI on `PATH` and `WAVEDASH_TOKEN` set, runs
   `wavedash build push`. Without the CLI (or with `WAVEDASH_DRY_RUN=1`) it only says what it would
   push. On GitHub: Actions › Wavedash › Run workflow, with the secret `WAVEDASH_TOKEN`.
4. **Publish it**: `wavedash publish <BUILD_ID>` (the id `build push` printed), or in the Developer
   Portal.

On Wavedash the game stays behind Wavedash's loading screen until it calls `Wavedash.init()`:
`js/main.js` does it through `js/wavedash.js` when the models have loaded (each model loaded moves
Wavedash's loading bar), or when loading fails, to show the error. Elsewhere (GitHub Pages, a local
server) there is no `Wavedash` object and the calls do nothing.

## Publishing on itch.io

The same builds go to [itch.io](https://itch.io) with
[butler](https://itch.io/docs/butler/), each to its own page as an HTML5 build: `pachino64` at https://sirmmo.itch.io/capitan-pachino-64.
`sh tools/itch.sh [game]` builds them as for Wavedash and runs `butler push <build>
sirmmo/<page>:html5`; without butler, or with `ITCH_DRY_RUN=1`, it only says what it would push.
In CI, Actions > Itch > Run workflow does the same, with the repository secret `BUTLER_API_KEY`
(an API key from https://itch.io/user/settings/api-keys). Each page must exist on itch.io before
its first push (Dashboard > Create new project, kind HTML); after the first upload, tick "This
file will be played in the browser" on it once.

