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
