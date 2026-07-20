# 🦖 VICLASAURUS

**The no-internet dinosaur grew up — and something grew up behind it.**

A complete neon pixel runner that lives inside any **wide, short strip** of your page
(40–80px tall). One JS file, zero dependencies, transparent background. Drop it in a
header, a footer, a 404 page, or that awkward gap in your `justify-between` layout.

> Five worlds. One chaser. Every obstacle you dodge gets eaten behind you.

## Quick start

```html
<script src="https://cdn.jsdelivr.net/gh/juanpe500/viclasaurus@main/viclasaurus.js"></script>

<div id="strip" style="height:56px"></div>
<script>
  const div = document.getElementById("strip");
  const dino_game = game_instance(div, "Click me");
</script>
```

That's it. Until someone clicks, the div contains nothing but a neon button with your
text — zero rendering cost. The click loads the game and starts the first run.

## API

| call | what it does |
| --- | --- |
| `game_instance(div)` | launch button labeled `PLAY` |
| `game_instance(div, "text")` | launch button with your label |
| `game_instance(div, { label, storageKey })` | options object — `storageKey` gives a strip its own hi-score bucket |

The returned instance:

```js
dino_game.score;      // live score (read-only)
dino_game.level;      // current level
dino_game.state;      // "waiting" | "run" | "over"
dino_game.canvas;     // the canvas element (null until booted)
dino_game.restart();  // fresh run (boots the game if still waiting)
dino_game.destroy();  // remove everything, free every listener
```

## The game

- **The chaser** — a giant dino head owns the left edge and *eats every obstacle you
  dodge*. Hits don't kill you; they knock you back toward the jaws. Run clean to
  rebuild your lead. Reach the teeth and it's over.
- **Every level lasts exactly 12 seconds** — only the speed climbs.
- **Every 5 levels the game reinvents itself** in a warp transition:

| levels | world | physics |
| --- | --- | --- |
| 1–5 | **THE DESERT** | classic: tap jump, hold crouch, mid-air slam |
| 6–10 | **THE DEEP** | open water, no floor — tap stroke, hold sink, don't leave the screen |
| 11–15 | **THE STORM** | jetpack: hold thrust, release fall — laser gates & missiles |
| 16–20 | **THE CAVERN** | classic + darkness: you see only a spotlight around you |
| 21–25 | **THE MOLTEN PATH** | lava pits open in the floor — fast-fall is your friend |
| 26+ | **the cycle repeats** | faster, and the darkness starts following you |

## Controls

| input | land worlds | the deep | the storm |
| --- | --- | --- | --- |
| tap / click / `Space` / `↑` | jump | stroke up | thrust (hold) |
| hold / right-click / `↓` / `S` | crouch · mid-air slam | sink fast | thrust (hold) |

One finger is enough on touch: tap to act, keep holding for the secondary move.

## Built for embedding

- **Transparent** — no background painted, ever. The page shows through.
- **Polite keyboard** — Space/arrows only captured while the pointer is over the game
  or it has focus. Never hijacks scrolling or typing.
- **Auto-pause** — scrolled out of view, the loop stops completely (zero CPU, zero
  audio) and resumes exactly where it froze.
- **Fair by design** — every spawn is checked in arrival-time space so overlapping
  obstacles can never form an unwinnable wall.
- **Multiple instances** — put ten strips on one page; each is independent and you pay
  only for the ones people actually play.

## Testing cheats

With the game focused, type `jp` (immortality) or `sp` (fast-forward). Both are
displayed on screen for the whole run, and any run that touched a cheat can never set
a hi-score.

## Demo

Open [`game.html`](game.html) — three live strips at 64/44/80px plus the full docs.

## License

MIT
