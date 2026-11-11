# Capitan Pachino 64

A 3D collect-the-stars platformer in the browser. Capitan Pachino, a tomato pirate, returns to the
Garden Isle to find it overrun: **vegetables are friends, steaks and fish are enemies**.
Recover the 7 Golden Stars.

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

Crouch + jump while running is a long jump, crouch + jump while standing is a backflip,
and jumping again right after hitting a wall in the air is a wall kick.

## The seven stars

1. King Steak of Mount Grill
2. Top of the Sky Carrot Tower
3. Eight Red Peppers
4. The Lost Cherry Tomatoes
5. Big Catch at Lake Lattuga
6. 100 Coin Feast
7. Steak Roundup

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
- `vendor/` – three.js r160

## Credits

- Food Kit and Platformer Kit by [Kenney](https://kenney.nl) (CC0)
- [three.js](https://threejs.org) (MIT)
