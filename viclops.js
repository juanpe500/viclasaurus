/*!
 * Viclops — neon pixel orbiter for square-ish divs (150–500px a side).
 *
 * The third sibling. Viclasaurus runs through wide strips, Viclanaut
 * climbs the narrow ones — Viclops lives in the boxes: cards, tiles,
 * avatars, that stubborn square hole in your dashboard.
 *
 * Usage:
 *   <script src="https://your-cdn.com/viclops.js"></script>
 *   const div = document.getElementById("tile");
 *   const orbit = viclops_instance(div, "Click me");
 *
 * Nothing is rendered at first except a neon button with your text
 * (second parameter, default "WAKE IT"). Clicking it loads the game:
 * a moth drifts in, the eye in the center opens, and the first orbit
 * begins. The canvas covers the whole div (transparent background, so
 * whatever is behind the div shows through).
 *
 * Instance API:
 *   orbit.restart()  – reset and start a fresh orbit
 *   orbit.destroy()  – stop the loop, remove listeners and canvas
 *   orbit.score / .level / .dust / .world / .state / .canvas (read-only)
 *
 * THE EYE — the center of the div is a vast lidded eye, and you are the
 * moth circling its glow. Everything in the world spirals inward and is
 * absorbed; every obstacle you dodge gets swallowed behind you (the
 * pupil dilates — it is pleased). Hits don't kill you: they knock you
 * into a lower, closer orbit. Fly clean to climb back out. Touch the
 * pupil and the eye closes around you.
 *
 * WORLDS — the dream reinvents itself every 5 levels (the eye blinks):
 *   1-5   THE GARDEN     glide: hold a side to spin, tap to dash
 *   6-10  THE CLOCKWORK  tick: you revolve forever — tap to reverse.
 *                        Clock hands sweep, chime rings close in
 *   11-15 THE STATIC     phase: tap to teleport-hop 45°. Glitch blocks
 *                        flicker into being, rings glitch their gaps
 *   16-20 THE ABYSS      glide + darkness — and some of the lights down
 *                        here are lying to you
 *   21-25 THE CROWN      glide + flare beams erupting from the eye
 *   26+   remixes: the cycle repeats faster, darkness creeps everywhere
 *
 * ALSO IN ORBIT — ember motes (chain them for bonuses), a shield orb,
 * an hourglass that slows the whole dream for a few seconds, and graze
 * bonuses for threading a ring gap by a wing's width. And now and then
 * the eye STARES: a wedge of gaze sweeps the field, and being seen
 * drags you inward — get out of the light. When you're closing in on
 * your record, a golden ring wakes around the iris: it remembers.
 *
 * Keyboard is only captured while the pointer is over the game or the
 * game canvas has focus, so it never hijacks the host page.
 */
(function (global) {
  "use strict";

  function game_instance(container, opts) {
    if (!container || !container.appendChild) {
      throw new Error("viclops_instance(container): container must be a DOM element");
    }
    if (typeof opts === "string") opts = { label: opts };  // viclops_instance(div, "Click me")
    else opts = opts || {};
    var storageKey = opts.storageKey || "viclops-hi";
    var label = opts.label || "WAKE IT";

    // --- mount: canvas covering absolutely all of the container -------
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      imageRendering: "pixelated",
      cursor: "pointer",
      userSelect: "none",
      webkitUserSelect: "none",
      touchAction: "manipulation",
      outline: "none",
    });
    canvas.tabIndex = 0;                 // focusable, so keys work after a click
    // NOTE: the canvas is NOT appended yet — until the player clicks the
    // launch button, the div contains nothing but that button.
    const ctx = canvas.getContext("2d", { alpha: true });

    // --- logical resolution -------------------------------------------
    // Square-ish canvas: the SHORTER side drives the pixel size, the
    // orbit is a circle around the center, and any extra length on the
    // longer axis just shows more of the dream.
    let W = 96, H = 96;
    let CX = 48, CY = 48;
    let R_MAX = 44, R_EYE = 12, R_MOUTH = 16, R_SAFE = 38, R_SPAWN = 76;

    const MW = 5;                        // the moth's rough pixel box

    function resize() {
      const cw = Math.max(1, container.clientWidth);
      const ch = Math.max(1, container.clientHeight);
      const scale = Math.max(1, Math.round(Math.min(cw, ch) / 96));
      W = Math.max(72, Math.ceil(cw / scale));
      H = Math.max(72, Math.ceil(ch / scale));
      canvas.width = W;
      canvas.height = H;
      CX = W / 2; CY = H / 2;
      R_MAX = Math.min(W, H) / 2 - 3;
      R_EYE = Math.max(9, Math.min(16, (R_MAX * 0.26) | 0));
      R_MOUTH = R_EYE + 4;                            // orbit radius at lead 0
      R_SAFE = R_MAX - 6;                             // orbit radius at lead 1
      R_SPAWN = Math.sqrt(W * W + H * H) / 2 + 8;     // just outside the corners
      ctx.imageSmoothingEnabled = false;
    }

    const GLOW = 3;
    const TAU = Math.PI * 2;

    // shortest signed angular distance a -> b, in [-PI, PI)
    function angDist(a, b) {
      let d = (b - a) % TAU;
      if (d < -Math.PI) d += TAU;
      if (d >= Math.PI) d -= TAU;
      return d;
    }
    const polX = (ang, rad) => CX + Math.cos(ang) * rad;
    const polY = (ang, rad) => CY + Math.sin(ang) * rad;

    // --- worlds ----------------------------------------------------------
    // pal: fg = moth/score, ob = main obstacles, ac = accent obstacles &
    //      toasts, env = rings, spokes & backdrop furniture.
    // eye = the watcher's colors (iris / lid / gaze-and-glow).
    const WORLDS = [
      { set:"garden", name:"THE GARDEN", mech:"glide", dark:false,
        pal:{ fg:"#ffe94d", ob:"#39ff14", ac:"#ff3ec8", env:"#8b6dff" },
        eye:{ iris:"#ff2e5e", lid:"#8b2440", glow:"#ffe94d" } },
      { set:"clock", name:"THE CLOCKWORK", mech:"tick", dark:false,
        pal:{ fg:"#00eaff", ob:"#ffd23a", ac:"#ff3ec8", env:"#8b6dff" },
        eye:{ iris:"#b26dff", lid:"#5a3d8a", glow:"#00eaff" } },
      { set:"static", name:"THE STATIC", mech:"phase", dark:false,
        pal:{ fg:"#f2f7ff", ob:"#ff3ec8", ac:"#00eaff", env:"#39ff14" },
        eye:{ iris:"#00b3ff", lid:"#155a8a", glow:"#ffe94d" } },
      { set:"abyss", name:"THE ABYSS", mech:"glide", dark:true,
        pal:{ fg:"#c9a7ff", ob:"#2e86ff", ac:"#39ff14", env:"#7a6dff" },
        eye:{ iris:"#ff2e5e", lid:"#701b35", glow:"#ffe94d" } },
      { set:"crown", name:"THE CROWN", mech:"glide", dark:false,
        pal:{ fg:"#ffd23a", ob:"#ff4d2e", ac:"#ffe94d", env:"#ff6a00" },
        eye:{ iris:"#ff6a00", lid:"#8a3400", glow:"#ffe94d" } },
    ];

    // a hint toast fired the moment a warp finishes — two of the physics
    // switches are rude surprises without one
    const HINTS = {
      garden: "",
      clock: "NO STOPPING TAP TO REVERSE",
      static: "TAP TO PHASE HOP",
      abyss: "NOT EVERY LIGHT IS A FRIEND",
      crown: "FLEE THE FLARES",
    };

    function worldFor(lvl) {
      const wi = ((lvl - 1) / 5) | 0;
      if (wi < WORLDS.length) return WORLDS[wi];
      // remix generations: the cycle repeats, darkness creeps in
      const base = WORLDS[wi % WORLDS.length];
      const gen = (wi / WORLDS.length) | 0;             // 1, 2, ...
      const w = Object.assign({}, base);
      w.name = base.name + " " + (gen + 1);
      w.dark = base.dark || gen >= 1;
      return w;
    }

    let world = WORLDS[0];
    const pal = () => world.pal;

    // --- pixel sprites ('#' = colored pixel) ----------------------------
    // The moth itself is drawn procedurally (it has to bank around a
    // circle); these are the things that fall into the dream.
    const PETAL = [
      ".##..",
      "####.",
      ".####",
      "..##.",
    ];
    const THORN = [
      "#.#.#",
      ".###.",
      "#####",
      ".###.",
      "#.#.#",
    ];
    const GEAR_B = [
      "#..#..#",
      ".#####.",
      "#######",
      "###.###",
      "#######",
      ".#####.",
      "#..#..#",
    ];
    const GEAR_S = [
      ".#.#.",
      "#####",
      "##.##",
      "#####",
      ".#.#.",
    ];
    const SPORE = [
      ".####.",
      "######",
      "##.###",
      "######",
      "###.##",
      ".####.",
    ];
    const EMBERF = [
      ".#.",
      "###",
      ".#.",
    ];
    const STAR1 = [
      ".#.",
      "###",
      ".#.",
    ];
    const STAR2 = [
      "..#..",
      "..#..",
      "#####",
      "..#..",
      "..#..",
    ];
    const ORB = [
      ".###.",
      "#...#",
      "#.#.#",
      "#...#",
      ".###.",
    ];
    const HOURGLASS = [
      "#####",
      ".###.",
      "..#..",
      ".###.",
      "#####",
    ];

    function drawSprite(rows, x, y, color) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = GLOW;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          if (row[c] === "#") ctx.fillRect((x + c) | 0, (y + r) | 0, 1, 1);
        }
      }
      ctx.restore();
    }

    // --- tiny 3x5 pixel font ---------------------------------------------
    const FONT = {
      "0":"111101101101111","1":"010110010010111","2":"111001111100111",
      "3":"111001111001111","4":"101101111001001","5":"111100111001111",
      "6":"111100111101111","7":"111001010010010","8":"111101111101111",
      "9":"111101111001111",
      "A":"111101111101101","B":"110101110101110","C":"111100100100111",
      "D":"110101101101110","E":"111100111100111","F":"111100111100100",
      "G":"111100101101111","H":"101101111101101","I":"111010010010111",
      "J":"001001001101111","K":"101101110101101","L":"100100100100111",
      "M":"101111111101101","N":"110101101101101","O":"111101101101111",
      "P":"111101111100100","Q":"111101101111001","R":"111101110101101",
      "S":"111100111001111","T":"111010010010010","U":"101101101101111",
      "V":"101101101101010","W":"101101111111101","X":"101101010101101",
      "Y":"101101010010010","Z":"111001010100111",
      "!":"010010010000010","+":"000010111010000","-":"000000111000000",
      ".":"000000000000010","*":"101010111010101","<":"001010100010001",
      ">":"100010001010100","/":"001001010100100",":":"000010000010000",
      " ":"000000000000000",
    };
    function textW(s, scale) { return (s.length * 4 - 1) * (scale || 1); }
    function drawText(s, x, y, color, scale) {
      const sc = scale || 1;
      ctx.save();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = GLOW;
      for (let i = 0; i < s.length; i++) {
        const g = FONT[s[i]] || FONT[" "];
        for (let b = 0; b < 15; b++) {
          if (g[b] === "1") {
            ctx.fillRect(x + i * 4 * sc + (b % 3) * sc, y + (b / 3 | 0) * sc, sc, sc);
          }
        }
      }
      ctx.restore();
    }
    function drawCentered(s, y, color, scale) {
      drawText(s, ((W - textW(s, scale)) / 2) | 0, y, color, scale);
    }
    function wrapLines(s) {
      const words = String(s).split(" ");
      const lines = [];
      let cur = "";
      for (let i = 0; i < words.length; i++) {
        const t = cur ? cur + " " + words[i] : words[i];
        if (textW(t) <= W - 6) cur = t;
        else { if (cur) lines.push(cur); cur = words[i]; }
      }
      if (cur) lines.push(cur);
      return lines;
    }
    // a centered block of lines around centerY, 7px per line — placed in
    // the band between the top edge and the eye, where the eye isn't
    function drawBlock(lines, centerY, color) {
      const total = lines.length * 7 - 2;
      let y = Math.max(2, (centerY - total / 2) | 0);
      for (let i = 0; i < lines.length; i++) {
        drawCentered(lines[i], y, color);
        y += 7;
      }
    }
    const msgY = () => Math.max(12, ((CY - R_EYE) / 2) | 0);

    // --- audio -------------------------------------------------------------
    let audio = null;
    function beep(freq, dur, type, vol) {
      try {
        if (!audio) audio = new (global.AudioContext || global.webkitAudioContext)();
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, audio.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
        o.connect(g).connect(audio.destination);
        o.start(); o.stop(audio.currentTime + dur);
      } catch (e) { /* audio is optional */ }
    }
    const sDash   = () => beep(640, 0.05, "square", 0.028);
    const sTick   = () => beep(420, 0.05, "square", 0.026);
    const sHop    = () => { beep(600, 0.04, "square", 0.03); setTimeout(() => beep(900, 0.05, "square", 0.02), 40); };
    const sHit    = () => { beep(95, 0.3, "sawtooth", 0.05); beep(180, 0.15, "square", 0.03); };
    const sDie    = () => beep(130, 0.25, "sawtooth", 0.04);
    const sGulp   = () => { beep(180, 0.07, "sine", 0.04); setTimeout(() => beep(95, 0.1, "sine", 0.035), 60); };
    const sGraze  = () => beep(1150, 0.04, "sine", 0.014);
    const sShield = () => { beep(660, 0.09, "sine", 0.035); setTimeout(() => beep(990, 0.12, "sine", 0.035), 80); };
    const sBreakS = () => beep(210, 0.2, "sawtooth", 0.045);
    const sCollect = (chain) => beep(500 + Math.min(9, chain) * 45, 0.06, "square", 0.03);
    const sSlow   = () => { beep(880, 0.1, "sine", 0.03); setTimeout(() => beep(440, 0.18, "sine", 0.03), 90); };
    const sLie    = () => { beep(300, 0.1, "sawtooth", 0.03); setTimeout(() => beep(210, 0.16, "sawtooth", 0.03), 90); };
    const sMile   = () => { beep(740, 0.07, "square", 0.03); setTimeout(() => beep(988, 0.1, "square", 0.03), 80); };
    const sLevel  = () => { beep(660, 0.08, "square", 0.03); setTimeout(() => beep(880, 0.10, "square", 0.03), 90); };
    const sWarp   = () => {
      beep(330, 0.09, "square", 0.03);
      setTimeout(() => beep(494, 0.09, "square", 0.03), 80);
      setTimeout(() => beep(659, 0.12, "square", 0.03), 160);
      setTimeout(() => beep(880, 0.16, "square", 0.035), 240);
    };
    const sWake   = () => {
      beep(60, 0.5, "sawtooth", 0.05);
      setTimeout(() => beep(90, 0.4, "sawtooth", 0.045), 200);
      setTimeout(() => beep(180, 0.25, "square", 0.03), 420);
    };
    const sGazeW  = () => beep(880, 0.12, "sawtooth", 0.02);
    const sPass   = () => beep(700, 0.04, "sine", 0.012);
    const sHum    = () => beep(64, 0.2, "sine", 0.035);
    const sBlip   = () => beep(1000 + Math.random() * 400, 0.03, "square", 0.016);

    // --- game state ----------------------------------------------------------
    // The eye below-you-in-every-direction: hits don't kill, they knock
    // you into a lower orbit. `lead` 1..0 is your orbital height;
    // 0 = swallowed. Regenerates while you fly clean.
    const HIT_DAMAGE = 0.4, LEAD_REGEN = 0.045, IFRAMES = 1.2;
    const WARP_TIME = 2.2;
    const LEVEL_TIME = 12;     // every level lasts exactly this many seconds
    const INTRO_FLY = 0.9, INTRO_END = 1.5;   // moth drifts in, the eye opens

    let state = "idle";                    // idle | run | over
    let score = 0, hiScore = 0, level = 1, runT = 0;
    let ang = -Math.PI / 2, aVel = 0, rad = 40;   // the moth, in polar
    let tickDir = 1, dashT = 0, dashDir = 1, hopCd = 0, lastDir = 1;
    let lead = 1, iframesT = 0, glareT = 0;
    let obstacles = [], pickups = [], particles = [];
    let stars = [], blips = [];
    let spawnT = 0, dustNext = 3, orbNext = 26, glassNext = 34;
    let animT = 0, overAt = 0;
    let toast = "", toastT = 0, shakeT = 0, gulpT = 0, warpT = 0;
    let shield = false, slowT = 0, chain = 0, chainT = 0, dustN = 0;
    let mileNext = 2000, newBest = false, recordFired = false;
    let hintQ = "";
    // the gaze: idle -> warn (rays flicker) -> sweep (the wedge moves)
    let gazeMode = "idle", gazeT = 0, gazeNext = 16, gazeAng = 0, gazeVel = 0, gazeHumT = 0;
    let gazedNow = false;
    // ring-gap fairness memory: where the last gap was, and when it lands
    let lastGapAng = null, lastGapT = 0;
    // wake cinematic: the moth drifts in from outside, the eye opens
    let introT = -1, blinkF = 1, pupilDil = 0, pupilAng = Math.PI / 2, wanderAng = Math.PI / 2, wanderT = 0;
    let ambBlinkT = 0, ambBlinkNext = 9;       // it blinks. Of course it blinks.
    let curX = -1, curY = -1;                  // last pointer position, in canvas px
    let grazeN = 0;                            // near-misses this run, for the tally

    try { hiScore = +localStorage.getItem(storageKey) || 0; } catch (e) {}

    function speedFor(lvl) { return 26 + (lvl - 1) * 3; }

    function seedScenery() {
      stars = []; blips = [];
      const n = (W * H) / 480;
      for (let i = 0; i < n; i++) {
        stars.push({
          ang: Math.random() * TAU,
          rad: R_EYE + 2 + Math.random() * (R_SPAWN - R_EYE),
          spin: 0.03 + Math.random() * 0.05,
        });
      }
    }

    function reset() {
      score = 0; level = 1; runT = 0;
      ang = -Math.PI / 2; aVel = 0; rad = R_SAFE;
      tickDir = 1; dashT = 0; hopCd = 0; lastDir = 1;
      lead = 1; iframesT = 0; glareT = 0;
      obstacles = []; pickups = []; particles = [];
      spawnT = 1.4; dustNext = 2.5; orbNext = 24 + Math.random() * 18;
      glassNext = 30 + Math.random() * 20;
      toast = ""; toastT = 0; shakeT = 0; gulpT = 0; warpT = 0;
      shield = false; slowT = 0; chain = 0; chainT = 0; dustN = 0;
      mileNext = 2000; newBest = false; recordFired = false; hintQ = "";
      gazeMode = "idle"; gazeT = 0; gazeNext = 14 + Math.random() * 8; gazedNow = false;
      lastGapAng = null; lastGapT = 0;
      introT = 0; blinkF = 1; pupilDil = 0;
      ambBlinkT = 0; ambBlinkNext = 8 + Math.random() * 8; grazeN = 0;
      cheatedRun = immortal || turbo;  // starting a run with a cheat on taints it too
      world = WORLDS[0];
    }

    // --- particle fx ---------------------------------------------------------
    function addParticle(p) {
      p.ttl = p.life;
      particles.push(p);
    }
    // the moth sheds glow-dust as it flies
    function trailMote(x, y) {
      addParticle({
        type: "trail", col: world.pal.fg,
        x, y, vx: Math.random() * 6 - 3, vy: Math.random() * 6 - 3,
        g: 0, size: 1,
        life: 0.25 + Math.random() * 0.2,
      });
    }
    function sparkleBurst(x, y, n) {
      for (let i = 0; i < n; i++) {
        addParticle({
          type: "sparkle", col: Math.random() < 0.5 ? "#ffd23a" : "#fff7d0",
          x: x + Math.random() * 4 - 2, y: y + Math.random() * 4 - 2,
          vx: Math.random() * 40 - 20, vy: Math.random() * 40 - 20,
          g: 0, size: 1,
          life: 0.3 + Math.random() * 0.2,
        });
      }
    }
    // gray crunch debris flung out of the pupil when the eye absorbs food
    const CHUNK_GRAYS = ["#aab2bd", "#8b939e", "#c8cdd4"];
    function gulpBurst(fromAng) {
      for (let i = 0; i < 6; i++) {
        const a = fromAng + Math.random() * 0.8 - 0.4;
        addParticle({
          type: "chunk",
          col: CHUNK_GRAYS[(Math.random() * CHUNK_GRAYS.length) | 0],
          x: polX(a, R_EYE - 1), y: polY(a, R_EYE - 1),
          vx: Math.cos(a) * (16 + Math.random() * 22),
          vy: Math.sin(a) * (16 + Math.random() * 22),
          g: 0, size: Math.random() < 0.3 ? 2 : 1,
          life: 0.35 + Math.random() * 0.25,
        });
      }
    }
    function ringFx(x, y, col) {
      addParticle({ type: "ring", col, x, y, vx: 0, vy: 0, g: 0, size: 1, life: 0.35 });
    }
    function floatText(txt, x, y, col) {
      addParticle({
        type: "txt", txt, col: col || "#ffd23a",
        x: (x - textW(txt) / 2) | 0, y,
        vx: 0, vy: -13, g: 0, size: 1, life: 0.8,
      });
    }
    // warp streaks spiral around the eye while the dream re-forms
    function swirlStreak() {
      addParticle({
        type: "swirl", col: world.pal.fg,
        sAng: Math.random() * TAU, sRad: R_SPAWN,
        sVr: -(90 + Math.random() * 70), sVa: 2 + Math.random() * 2,
        x: 0, y: 0, vx: 0, vy: 0, g: 0, size: 1,
        life: 0.5 + Math.random() * 0.3,
      });
    }
    function glitchFleck(x, y) {
      addParticle({
        type: "sparkle", col: Math.random() < 0.5 ? world.pal.ob : world.pal.ac,
        x: x + Math.random() * 6 - 3, y: y + Math.random() * 6 - 3,
        vx: 0, vy: 0, g: 0, size: 1,
        life: 0.1 + Math.random() * 0.1,
      });
    }

    // --- fair spawning ----------------------------------------------------
    // Everything falls inward, but at different speeds — a fast thorn
    // spawned behind a slow petal could reach your orbit at the same
    // instant, an unwinnable pincer. Every new faller gets pushed further
    // out until its ARRIVAL TIME at your orbit is separated from every
    // live faller's by more than a full half-circle of flight.
    const MIN_ARRIVAL_SEP = 0.55;

    function fairRad(desiredRad, v, ref) {
      let t = (desiredRad - R_SAFE) / v;
      for (let guard = 0; guard < 8; guard++) {
        let bumped = false;
        for (const o of obstacles) {
          const ov = o.vr || 0;
          if (ov <= 3) continue;                 // hands, blocks, arcs: no arrival
          const ot = (o.rad - R_SAFE) / ov;
          if (Math.abs(t - ot) < MIN_ARRIVAL_SEP) { t = ot + MIN_ARRIVAL_SEP; bumped = true; }
        }
        if (!bumped) break;
      }
      return R_SAFE + t * v;
    }

    // A ring is one dodge: a full circle contracting toward the eye with
    // a single gap. The next ring's gap is always placed within reach of
    // the last one, so back-to-back rings are a weave, never a wall.
    function pushRing(v, kind) {
      const rad0 = fairRad(R_SPAWN, v, v);
      const arriveT = runT + (rad0 - R_SAFE) / v;
      const gapHalf = Math.max(0.32, 0.8 - level * 0.018);
      let gapAng;
      if (lastGapAng == null) {
        gapAng = ang + (Math.random() * 2 - 1) * 1.2;
      } else {
        const reach = Math.max(0.9, 2.2 * Math.abs(arriveT - lastGapT)) * 0.7;
        gapAng = lastGapAng + (Math.random() * 2 - 1) * reach;
      }
      lastGapAng = gapAng; lastGapT = arriveT;
      obstacles.push({ kind: kind || "ring", rad: rad0, vr: v, gapAng, gapHalf, th: 2 });
    }

    // --- per-world spawn tables ----------------------------------------------
    function spawnGarden(v) {
      const roll = Math.random();
      if (roll < 0.3) {
        // a petal flutters down in lazy spirals
        obstacles.push({
          kind: "petal", ang: Math.random() * TAU, rad: fairRad(R_SPAWN, v * 0.8, v),
          vr: v * 0.8, va: (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.4),
          ph: Math.random() * TAU, w: 5, h: 4,
        });
      } else if (roll < 0.55) {
        // some thorns are seed pods: they shiver, then burst into three
        const splitter = level >= 4 && Math.random() < 0.45;
        obstacles.push({
          kind: "thorn", ang: Math.random() * TAU, rad: fairRad(R_SPAWN, v * 1.15, v),
          vr: v * 1.15, va: (Math.random() * 2 - 1) * 0.25, w: 5, h: 5,
          split: splitter ? R_SAFE + 14 + Math.random() * 10 : 0,
        });
      } else if (level >= 2 && roll < 0.78) {
        pushRing(v * 0.95, "ring");
      } else if (level >= 3) {
        // a vine whip: an arc of briar sweeping the orbit lanes
        obstacles.push({
          kind: "arc", ang: Math.random() * TAU,
          rad: fairRad(R_SPAWN, v * 0.5, v), vr: v * 0.5,
          va: (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.5 + level * 0.02),
          half: 0.35 + Math.random() * 0.2, th: 2,
        });
      } else {
        obstacles.push({
          kind: "petal", ang: Math.random() * TAU, rad: fairRad(R_SPAWN, v * 0.8, v),
          vr: v * 0.8, va: 0.4, ph: Math.random() * TAU, w: 5, h: 4,
        });
      }
    }

    function spawnClock(v) {
      const roll = Math.random();
      // the hands are permanent fixtures: at most two, added once each
      const hands = obstacles.filter((o) => o.kind === "hand").length;
      if (hands === 0 || (hands === 1 && level >= 8 && roll < 0.2)) {
        obstacles.push({
          kind: "hand", ang: Math.random() * TAU, rad: 0, vr: 0,
          va: (Math.random() < 0.5 ? -1 : 1) * (0.5 + level * 0.02),
        });
        return;
      }
      if (roll < 0.35) {
        pushRing(v * 0.95, "chime");
      } else if (roll < 0.65) {
        const big = Math.random() < 0.4;
        obstacles.push({
          kind: "gear", big, ang: Math.random() * TAU,
          rad: fairRad(R_SPAWN, v, v), vr: v,
          va: (Math.random() * 2 - 1) * 0.3, rot: Math.random() * TAU,
          w: big ? 7 : 5, h: big ? 7 : 5,
        });
      } else {
        // a pendulum bob swinging across the lanes
        obstacles.push({
          kind: "bob", base: Math.random() * TAU,
          amp: 0.5 + Math.random() * 0.4, freq: 1.4 + Math.random() * 0.8,
          ph: Math.random() * TAU, ang: 0,
          rad: fairRad(R_SPAWN, v * 0.45, v), vr: v * 0.45, w: 3, h: 3,
        });
      }
    }

    function spawnStatic(v) {
      const roll = Math.random();
      if (roll < 0.35) {
        // a glitch block: static warning, then it is very real
        let a = Math.random() * TAU;
        if (Math.abs(angDist(ang, a)) < 0.6) a += Math.PI / 2;  // never on your head
        obstacles.push({
          kind: "block", ang: a,
          rad: R_MOUTH + 4 + Math.random() * (R_SAFE - R_MOUTH - 6),
          vr: 2, mode: "warn", mt: 0.55, w: 5, h: 5,
        });
      } else if (roll < 0.6) {
        pushRing(v * 0.95, "glitchring");
      } else if (roll < 0.85) {
        // a scan beam: warn, then a spoke fires through the field
        obstacles.push({
          kind: "beam", ang: Math.random() * TAU, rad: 0, vr: 0,
          mode: "warn", mt: 0.7, va: 0, fireT: 0.7,
        });
      } else {
        obstacles.push({
          kind: "bit", ang: Math.random() * TAU, rad: fairRad(R_SPAWN, v * 1.4, v),
          vr: v * 1.4, va: (Math.random() * 2 - 1) * 0.4, w: 2, h: 2,
        });
      }
    }

    function spawnAbyss(v) {
      const roll = Math.random();
      if (roll < 0.35) {
        obstacles.push({
          kind: "spore", ang: Math.random() * TAU, rad: fairRad(R_SPAWN, v * 0.7, v),
          vr: v * 0.7, va: (Math.random() * 2 - 1) * 0.2, w: 6, h: 6,
        });
      } else if (roll < 0.6) {
        pushRing(v * 0.9, "ring");
      } else if (roll < 0.8) {
        obstacles.push({
          kind: "arc", ang: Math.random() * TAU,
          rad: fairRad(R_SPAWN, v * 0.5, v), vr: v * 0.5,
          va: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.5),
          half: 0.3 + Math.random() * 0.2, th: 2,
        });
      } else {
        // an angler's lure: it looks like food. It is not food.
        pickups.push({
          kind: "lure", ang: Math.random() * TAU,
          rad: R_SPAWN * 0.8, vr: v * 0.55, ph: Math.random() * TAU,
        });
      }
    }

    function spawnCrown(v) {
      const roll = Math.random();
      if (roll < 0.35) {
        // a flare beam with a slow sweep — the eye lashes out
        obstacles.push({
          kind: "beam", ang: Math.random() * TAU, rad: 0, vr: 0,
          mode: "warn", mt: 0.7, va: (Math.random() < 0.5 ? -1 : 1) * 0.5, fireT: 0.9,
        });
      } else if (roll < 0.6) {
        obstacles.push({
          kind: "emberf", ang: Math.random() * TAU, rad: fairRad(R_SPAWN, v * 1.3, v),
          vr: v * 1.3, va: (Math.random() * 2 - 1) * 0.35, w: 3, h: 3,
        });
      } else if (roll < 0.82) {
        pushRing(v, "firering");
      } else {
        // a prominence pair: two whips on opposite sides, spinning against
        // each other — the safe lanes rotate, so you rotate with them
        const a0 = Math.random() * TAU;
        const r0 = fairRad(R_SPAWN, v * 0.55, v);
        const spin = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 0.6);
        obstacles.push({
          kind: "arc", ang: a0, rad: r0, vr: v * 0.55,
          va: spin, half: 0.3 + Math.random() * 0.15, th: 2,
        });
        obstacles.push({
          kind: "arc", ang: a0 + Math.PI, rad: r0, vr: v * 0.55,
          va: -spin, half: 0.3 + Math.random() * 0.15, th: 2,
        });
      }
    }

    function spawnObstacle(v) {
      if (world.set === "clock") spawnClock(v);
      else if (world.set === "static") spawnStatic(v);
      else if (world.set === "abyss") spawnAbyss(v);
      else if (world.set === "crown") spawnCrown(v);
      else spawnGarden(v);
    }

    // --- pickups ---------------------------------------------------------
    // Ember motes drift in along arcs; chaining them (within 3.5s of
    // each other) is worth more and more. The eye eats what you miss.
    function spawnDust(v) {
      const n = 3 + (Math.random() * 3 | 0);
      const a0 = Math.random() * TAU;
      const da = (Math.random() < 0.5 ? -1 : 1) * (0.28 + Math.random() * 0.2);
      for (let i = 0; i < n; i++) {
        pickups.push({
          kind: "dust", ang: a0 + da * i,
          rad: R_SPAWN + i * 7, vr: v * 0.8, tw: Math.random() * 4,
        });
      }
    }
    function spawnOrb(v) {
      pickups.push({ kind: "orb", ang: Math.random() * TAU, rad: R_SPAWN, vr: v * 0.7, ph: Math.random() * TAU });
    }
    function spawnGlass(v) {
      pickups.push({ kind: "glass", ang: Math.random() * TAU, rad: R_SPAWN, vr: v * 0.7, ph: Math.random() * TAU });
    }

    // --- input ---------------------------------------------------------------
    // Pointer input is scoped to the canvas: press-and-hold on the left
    // or right half spins you that way (left = counterclockwise); a
    // fresh tap is also the "act" verb — dash, reverse, or phase-hop,
    // depending on the world. Keyboard is scoped to "the pointer is over
    // the game, or the canvas has focus", so the script never steals
    // keys from the host page.
    let hovered = false, focused = false, destroyed = false;
    let ptrDown = false, ptrDir = 0, keyL = false, keyR = false;
    // testing cheats: type "jp" = immortality, "sp" = 5x speed.
    // Both are displayed on screen and disqualify the run from hi-scores.
    let immortal = false, turbo = false, cheatBuf = "", cheatedRun = false;

    function currentDir() {
      if (ptrDir !== 0) return ptrDir;
      if (keyL && !keyR) return -1;
      if (keyR && !keyL) return 1;
      return 0;
    }

    function press() {
      if (state === "idle") {
        reset(); state = "run";
      } else if (state === "run") {
        if (introT >= 0) {
          if (introT > 0.15) introT = Math.max(introT, INTRO_END - 0.1);  // skip the wake
          return;
        }
        const dir = currentDir();
        if (dir !== 0) lastDir = dir;
        if (world.mech === "tick") {
          tickDir = dir !== 0 ? dir : -tickDir;   // reverse the escapement
          sTick();
        } else if (world.mech === "phase") {
          if (hopCd <= 0) {                       // teleport-hop 45 degrees
            const hd = dir !== 0 ? dir : lastDir;
            for (let i = 0; i < 4; i++) {
              trailMote(polX(ang, rad), polY(ang, rad));
            }
            ang += hd * (Math.PI / 4);
            hopCd = 0.12;
            sHop();
          }
        } else if (dir !== 0) {
          dashDir = dir; dashT = 0.13;            // dash along the orbit
          sDash();
        }
      } else if (state === "over" && performance.now() - overAt > 450) {
        reset(); state = "run";
      }
    }
    function keysActive(e) {
      if (destroyed || !(hovered || focused)) return false;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return false;
      return true;
    }
    function sideOf(e) {
      const rect = canvas.getBoundingClientRect();
      return (e.clientX - rect.left) < rect.width / 2 ? -1 : 1;
    }

    const onPointerDown = (e) => {
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      ptrDown = true;
      ptrDir = sideOf(e);
      press();
    };
    const onPointerMove = (e) => {
      if (ptrDown) ptrDir = sideOf(e);
      // the eye keeps track of where you are, even between runs
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        curX = (e.clientX - rect.left) / rect.width * W;
        curY = (e.clientY - rect.top) / rect.height * H;
      }
    };
    const onPointerUp = () => { ptrDown = false; ptrDir = 0; };
    const onEnter = () => { hovered = true; };
    const onLeave = () => { hovered = false; };
    const onFocus = () => { focused = true; };
    const onBlurCanvas = () => { focused = false; };
    const onCtxMenu = (e) => e.preventDefault();
    const onKeyDown = (e) => {
      if (!keysActive(e)) return;
      // cheat: typing "jp" toggles immortality — shown on screen and the
      // run is flagged, so it can never set a real hi-score
      if (e.key && e.key.length === 1) {
        cheatBuf = (cheatBuf + e.key.toLowerCase()).slice(-2);
        if (cheatBuf === "jp") {
          immortal = !immortal;
          toast = immortal ? "IMMORTAL ON" : "IMMORTAL OFF";
          toastT = 1.6;
          sLevel();
          cheatBuf = "";
        } else if (cheatBuf === "sp") {
          turbo = !turbo;
          toast = turbo ? "TURBO ON" : "TURBO OFF";
          toastT = 1.6;
          sLevel();
          cheatBuf = "";
        }
      }
      if (e.code === "ArrowLeft" || e.code === "KeyA") { e.preventDefault(); keyL = true; lastDir = -1; }
      if (e.code === "ArrowRight" || e.code === "KeyD") { e.preventDefault(); keyR = true; lastDir = 1; }
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        if (!e.repeat) press();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === "ArrowLeft" || e.code === "KeyA") keyL = false;
      if (e.code === "ArrowRight" || e.code === "KeyD") keyR = false;
    };
    const onWinBlur = () => { keyL = false; keyR = false; ptrDown = false; ptrDir = 0; };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerenter", onEnter);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("focus", onFocus);
    canvas.addEventListener("blur", onBlurCanvas);
    canvas.addEventListener("contextmenu", onCtxMenu);
    global.addEventListener("keydown", onKeyDown);
    global.addEventListener("keyup", onKeyUp);
    global.addEventListener("blur", onWinBlur);

    // --- hits ------------------------------------------------------------------
    function die() {
      state = "over"; overAt = performance.now(); shakeT = 0.5;
      sDie();
      newBest = false;
      if (score > hiScore && !cheatedRun) {
        hiScore = score | 0;
        newBest = true;
        try { localStorage.setItem(storageKey, hiScore); } catch (e) {}
      }
    }
    function applyHit() {
      if (immortal) return;
      lead -= HIT_DAMAGE;
      iframesT = IFRAMES; glareT = 0.8; shakeT = 0.3;
      chain = 0; chainT = 0;                     // a hit breaks the mote chain
      if (lead <= 0) {
        lead = 0;                                // spirals into the pupil
        die();
      } else {
        sHit();
      }
    }
    function hitBy(o) {
      if (o) o.grazed = true;                    // no graze bonus for a hit
      if (shield) {
        shield = false;
        iframesT = 1.0; shakeT = 0.25;
        ringFx(polX(ang, rad), polY(ang, rad), "#7ef7ff");
        sBreakS();
      } else {
        applyHit();
      }
    }
    // the eye absorbs everything that spirals past you
    function gulp(fromAng) {
      gulpBurst(fromAng);
      if (gulpT <= 0.05) sGulp();
      gulpT = 0.25;
      pupilDil = 1;
    }

    // --- collision, in polar ---------------------------------------------------
    // The moth is a ~5px box at (ang, rad). Each kind checks its own
    // geometry; a 1px mercy margin is baked into the thresholds.
    function collides(o) {
      const mx = polX(ang, rad), my = polY(ang, rad);
      if (o.kind === "ring" || o.kind === "chime" || o.kind === "glitchring" || o.kind === "firering") {
        if (Math.abs(o.rad - rad) > o.th + 1.5) return false;
        return Math.abs(angDist(o.gapAng, ang)) > o.gapHalf;
      }
      if (o.kind === "hand") {
        if (rad < R_EYE + 2) return false;
        const half = (2.5 / Math.max(8, rad)) + 0.02;
        return Math.abs(angDist(o.ang, ang)) < half;
      }
      if (o.kind === "beam") {
        if (o.mode !== "fire") return false;
        const half = (3 / Math.max(8, rad)) + 0.02;
        return Math.abs(angDist(o.ang, ang)) < half;
      }
      if (o.kind === "arc") {
        if (Math.abs(o.rad - rad) > o.th + 1.5) return false;
        return Math.abs(angDist(o.ang, ang)) < o.half;
      }
      if (o.kind === "block" && o.mode !== "solid") return false;
      // everything else: a small box at its polar position
      const ox = polX(o.ang, o.rad), oy = polY(o.ang, o.rad);
      const rw = (o.w || 4) / 2 + MW / 2 - 1;
      const rh = (o.h || 4) / 2 + MW / 2 - 1;
      return Math.abs(ox - mx) < rw && Math.abs(oy - my) < rh;
    }
    // near-miss: the same geometry, 2px looser
    function grazes(o) {
      const mx = polX(ang, rad), my = polY(ang, rad);
      if (o.kind === "ring" || o.kind === "chime" || o.kind === "glitchring" || o.kind === "firering") {
        if (Math.abs(o.rad - rad) > o.th + 1.5) return false;
        const margin = Math.abs(angDist(o.gapAng, ang));
        return margin <= o.gapHalf && margin > o.gapHalf - 0.14;
      }
      if (o.kind === "hand" || o.kind === "beam") {
        if (o.kind === "beam" && o.mode !== "fire") return false;
        const half = (3 / Math.max(8, rad)) + 0.02;
        const d = Math.abs(angDist(o.ang, ang));
        return d >= half && d < half + 0.09;
      }
      if (o.kind === "arc") {
        if (Math.abs(o.rad - rad) > o.th + 3.5) return false;
        return Math.abs(angDist(o.ang, ang)) < o.half + 0.06;
      }
      if (o.kind === "block" && o.mode !== "solid") return false;
      const ox = polX(o.ang, o.rad), oy = polY(o.ang, o.rad);
      const rw = (o.w || 4) / 2 + MW / 2 + 2;
      const rh = (o.h || 4) / 2 + MW / 2 + 2;
      return Math.abs(ox - mx) < rw && Math.abs(oy - my) < rh;
    }

    // --- update ----------------------------------------------------------------
    function update(dt) {
      animT += dt;
      if (toastT > 0) toastT -= dt;
      if (shakeT > 0) shakeT -= dt;
      if (iframesT > 0) iframesT -= dt;
      if (glareT > 0) glareT -= dt;
      if (gulpT > 0) gulpT -= dt;
      if (dashT > 0) dashT -= dt;
      if (hopCd > 0) hopCd -= dt;
      if (slowT > 0) slowT -= dt;
      if (chainT > 0) { chainT -= dt; if (chainT <= 0) chain = 0; }
      if (pupilDil > 0) pupilDil = Math.max(0, pupilDil - dt * 3);
      if (warpT > 0) {
        warpT -= dt;
        swirlStreak(); swirlStreak(); swirlStreak();
        if (warpT <= 0 && hintQ) { toast = hintQ; toastT = 1.8; hintQ = ""; }
      }
      if (turbo && Math.random() < dt * 20) swirlStreak();

      // the pupil wanders idly, glares at you when you're hit
      wanderT -= dt;
      if (wanderT <= 0) {
        wanderT = 1.2 + Math.random() * 2;
        wanderAng = Math.random() * TAU;
      }
      if (state === "run") {
        const lookTarget = glareT > 0 ? Math.atan2(polY(ang, rad) - CY, polX(ang, rad) - CX)
          : gazeMode !== "idle" ? gazeAng : wanderAng;
        pupilAng += angDist(pupilAng, lookTarget) * Math.min(1, dt * (glareT > 0 ? 10 : 3));
      }
      // and every so often, mid-run, it simply blinks. Cosmetic. Unsettling.
      if (state === "run" && introT < 0 && warpT <= 0) {
        ambBlinkNext -= dt;
        if (ambBlinkNext <= 0) { ambBlinkNext = 8 + Math.random() * 8; ambBlinkT = 0.36; }
      }
      if (ambBlinkT > 0) ambBlinkT -= dt;

      const v = state === "run" ? speedFor(level) + Math.min(14, score * 0.008) : 10;
      // the hourglass slows the dream, never the moth
      const wdt = dt * (slowT > 0 ? 0.55 : 1);

      // backdrop stars spiral forever into the eye
      for (const s of stars) {
        s.rad -= v * 0.06 * wdt;
        s.ang += s.spin * wdt;
        if (s.rad < R_EYE + 1) { s.rad = R_SPAWN; s.ang = Math.random() * TAU; }
      }
      if (world.set === "static" && Math.random() < dt * 10) {
        blips.push({ x: Math.random() * W, y: Math.random() * H, ttl: 0.12 });
      }
      blips = blips.filter((b) => (b.ttl -= dt) > 0);

      // particle fx keep animating even after death, so bursts finish fading
      for (const pt of particles) {
        pt.ttl -= dt;
        if (pt.type === "swirl") {
          pt.sRad += pt.sVr * dt;
          pt.sAng += pt.sVa * dt;
          pt.x = polX(pt.sAng, Math.max(2, pt.sRad));
          pt.y = polY(pt.sAng, Math.max(2, pt.sRad));
        } else {
          pt.vy += pt.g * dt;
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
        }
      }
      particles = particles.filter((pt) => pt.ttl > 0);

      if (state !== "run") {
        // it closes over its meal, content... then cracks half-open and
        // follows your cursor around the tile, waiting for you to retry
        const wait = state === "over" ? performance.now() - overAt : 1e9;
        if (wait < 1400) {
          blinkF = Math.min(1, blinkF + dt * 2);
        } else {
          blinkF += (0.45 - blinkF) * Math.min(1, dt * 2);
          if (hovered && curX >= 0) {
            const want = Math.atan2(curY - CY, curX - CX);
            pupilAng += angDist(pupilAng, want) * Math.min(1, dt * 6);
            // lean your cursor in close and the pupil dilates. Interested.
            const cd = Math.sqrt((curX - CX) * (curX - CX) + (curY - CY) * (curY - CY));
            if (cd < R_EYE * 2) pupilDil = Math.max(pupilDil, 0.6);
          } else {
            pupilAng += angDist(pupilAng, wanderAng) * Math.min(1, dt * 3);
          }
        }
        return;
      }

      if (immortal || turbo) cheatedRun = true;  // any cheated moment taints the run

      // --- wake cinematic: the moth drifts in, the eye opens ---------------
      if (introT >= 0) {
        introT += dt;
        if (introT < INTRO_FLY) {
          const p = introT / INTRO_FLY;
          const e2 = p * p * (3 - 2 * p);
          rad = R_SPAWN - (R_SPAWN - R_SAFE) * e2;
          ang = -Math.PI / 2 - (1 - e2) * 1.6;
          blinkF = 1;
          lead = 1;
          return;
        }
        blinkF = Math.max(0, 1 - (introT - INTRO_FLY) / (INTRO_END - INTRO_FLY));
        if (introT - dt < INTRO_FLY) {           // the moment it stirs
          toast = "IT WAKES"; toastT = 1;
          shakeT = 0.3;
          sWake();
        }
        rad = R_SAFE; lead = 1;
        if (introT >= INTRO_END) {
          introT = -1;
          blinkF = 0;
          spawnT = Math.min(spawnT, 0.8);
        } else {
          return;
        }
      }

      // lead regenerates while you fly clean; the moth eases toward the
      // orbit its lead has earned
      lead = Math.min(1, lead + LEAD_REGEN * dt);
      const targetRad = R_MOUTH + (R_SAFE - R_MOUTH) * lead;
      rad += (targetRad - rad) * Math.min(1, dt * 5);

      // score, level, and the blink between worlds — every level lasts
      // exactly LEVEL_TIME seconds; only the speed climbs
      score += v * wdt * 0.12;
      runT += dt;
      if (score >= mileNext) {
        toast = mileNext + "!"; toastT = 1.2;
        ringFx(CX, CY, "#ffd23a");
        sMile();
        mileNext += 2000;
      }
      if (!recordFired && hiScore > 0 && !cheatedRun && score >= hiScore) {
        recordFired = true;
        toast = "RECORD!"; toastT = 1.4;
        ringFx(CX, CY, "#ffd23a");
        sMile();
      }
      const newLevel = 1 + ((runT / LEVEL_TIME) | 0);
      if (newLevel !== level) {
        level = newLevel;
        const nw = worldFor(level);
        if (nw.name !== world.name) {
          world = nw;
          warpT = WARP_TIME;
          iframesT = Math.max(iframesT, WARP_TIME + 0.1);   // safe while adapting
          obstacles = [];
          lastGapAng = null;
          toast = ""; toastT = 0;
          shakeT = 0.25;
          blinkF = 1;                                       // the eye blinks...
          hintQ = HINTS[nw.set] || "";
          gazeMode = "idle"; gazeNext = 6 + Math.random() * 6;
          sWarp();
        } else {
          toast = "LEVEL " + level; toastT = 1.4;
          shakeT = 0.2;
          sLevel();
        }
      }
      if (warpT <= 0 && blinkF > 0 && introT < 0) {
        blinkF = Math.max(0, blinkF - dt * 3);              // ...and reopens
      }

      // --- the gaze: being seen drags you inward ---------------------------
      gazedNow = false;
      if (level >= 3 && warpT <= 0) {
        if (gazeMode === "idle") {
          gazeNext -= wdt;
          if (gazeNext <= 0) {
            gazeMode = "warn"; gazeT = 0.7;
            gazeAng = Math.random() * TAU;
            gazeVel = (Math.random() < 0.5 ? -1 : 1) * 1.1;
            sGazeW();
          }
        } else if (gazeMode === "warn") {
          gazeT -= wdt;
          if (gazeT <= 0) { gazeMode = "sweep"; gazeT = 2.4; }
        } else {
          gazeT -= wdt;
          gazeAng += gazeVel * wdt;
          const half = 0.45;
          if (Math.abs(angDist(gazeAng, ang)) < half) {
            gazedNow = true;
            if (!immortal) {
              lead = Math.max(0, lead - 0.12 * dt);
              if (lead <= 0) die();
            }
            gazeHumT -= dt;
            if (gazeHumT <= 0) { gazeHumT = 0.3; sHum(); }
            // streamers peel off the moth toward the pupil — you can SEE
            // the drag
            if (Math.random() < dt * 25) {
              const gx = polX(ang, rad), gy = polY(ang, rad);
              addParticle({
                type: "trail", col: world.eye.glow,
                x: gx, y: gy,
                vx: (CX - gx) * 0.9, vy: (CY - gy) * 0.9,
                g: 0, size: 1, life: 0.35,
              });
            }
          }
          if (gazeT <= 0) {
            gazeMode = "idle";
            gazeNext = 14 + Math.random() * 10;
          }
        }
      }

      // --- moth physics, per world mechanic --------------------------------
      const mech = world.mech;
      const dir = currentDir();
      if (dir !== 0) lastDir = dir;
      const drag = gazedNow ? 0.55 : 1;          // the gaze is thick to fly in

      if (mech === "glide") {
        if (dashT > 0) {
          aVel = dashDir * 6.5;
        } else {
          const tv = dir * 3.4;
          aVel += (tv - aVel) * Math.min(1, dt * 9);
        }
        ang += aVel * drag * dt;
      } else if (mech === "tick") {
        if (dir !== 0 && dir !== tickDir) { tickDir = dir; sTick(); }
        const ts = Math.min(3.6, 2.4 + level * 0.03);
        aVel = tickDir * ts;
        ang += aVel * drag * dt;
      } else {                                   // phase: hops do the moving
        aVel *= Math.pow(0.001, dt);             // any drift dies fast
        ang += dir * 0.9 * drag * dt;            // holding = slow creep
      }
      ang = ang % TAU;

      // the moth sheds light as it flies
      if (Math.random() < dt * 30) trailMote(polX(ang, rad), polY(ang, rad));

      // ambient flavor drifting through each layer of the dream
      if (introT < 0) {
        if (world.set === "garden" && Math.random() < dt * 3) {
          addParticle({ type: "trail", col: world.pal.ac,        // pollen
            x: Math.random() * W, y: Math.random() * H,
            vx: 3 + Math.random() * 4, vy: 2 + Math.random() * 3,
            g: 0, size: 1, life: 0.9 });
        } else if (world.set === "crown" && Math.random() < dt * 5) {
          const ea = Math.random() * TAU;                        // embers
          addParticle({ type: "trail", col: world.pal.ac,
            x: polX(ea, R_EYE + 1), y: polY(ea, R_EYE + 1),
            vx: Math.cos(ea) * (14 + Math.random() * 12),
            vy: Math.sin(ea) * (14 + Math.random() * 12),
            g: 0, size: 1, life: 0.5 });
        } else if (world.set === "clock" && Math.random() < dt * 8) {
          // the escapement: a spark rides the rim once around per second
          const tickA = (runT % 1) * TAU - Math.PI / 2;
          addParticle({ type: "trail", col: world.pal.ac,
            x: polX(tickA, R_EYE + 3), y: polY(tickA, R_EYE + 3),
            vx: 0, vy: 0, g: 0, size: 1, life: 0.25 });
        }
      }

      // --- obstacles ----------------------------------------------------------
      if (introT < 0) {
        spawnT -= wdt;
        if (spawnT <= 0 && warpT <= 0) {
          spawnObstacle(v);
          const base = Math.max(0.55, 1.55 - level * 0.055);
          spawnT = base * (0.75 + Math.random() * 0.5);
        }
      }
      for (const o of obstacles) {
        if (o.kind === "hand") {
          o.ang += o.va * wdt;
        } else if (o.kind === "beam") {
          o.mt -= wdt;
          if (o.mode === "warn" && o.mt <= 0) { o.mode = "fire"; o.mt = o.fireT; sBlip(); shakeT = Math.max(shakeT, 0.1); }
          else if (o.mode === "fire") {
            o.ang += o.va * wdt;
            if (o.mt <= 0) o.mode = "done";
          }
        } else if (o.kind === "block") {
          o.rad -= o.vr * wdt;
          o.mt -= wdt;
          if (o.mode === "warn") {
            if (Math.random() < dt * 30) glitchFleck(polX(o.ang, o.rad), polY(o.ang, o.rad));
            if (o.mt <= 0) { o.mode = "solid"; o.mt = 1.3; sBlip(); }
          } else if (o.mode === "solid" && o.mt <= 0) {
            o.mode = "done";
          }
        } else if (o.kind === "bob") {
          o.rad -= o.vr * wdt;
          o.ang = o.base + Math.sin(animT * o.freq + o.ph) * o.amp;
        } else {
          o.rad -= o.vr * wdt;
          if (o.va) o.ang += o.va * wdt;
          if (o.kind === "petal") o.ang += Math.sin(animT * 2 + o.ph) * 0.4 * wdt;
          if (o.kind === "gear") o.rot += (o.big ? 1.6 : -2.2) * wdt;
          if (o.kind === "thorn" && o.split && !o.popped && o.rad < o.split) {
            o.popped = true; o.cull = true;
            sBlip();
            sparkleBurst(polX(o.ang, o.rad), polY(o.ang, o.rad), 4);
            for (let k = -1; k <= 1; k++) {
              obstacles.push({
                kind: "bit", ang: o.ang + k * 0.22, rad: o.rad,
                vr: o.vr * (1.1 + Math.random() * 0.3),
                va: (o.va || 0) + k * 0.5, w: 2, h: 2,
              });
            }
          }
          if (o.kind === "glitchring" && o.glitched == null && o.rad < R_SAFE + 16) {
            // the gap teleports once on approach — with an audible blip
            o.glitched = true;
            o.gapAng += (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.5);
            lastGapAng = o.gapAng;
            sBlip();
          }
          if (o.kind === "emberf" && Math.random() < dt * 20) {
            trailMote(polX(o.ang, o.rad), polY(o.ang, o.rad));
          }
          // threading a ring cleanly is worth a little — and it chirps
          if (o.gapAng != null && !o.passed && o.rad < rad - 4) {
            o.passed = true;
            if (iframesT <= 0 && state === "run") { score += 2; sPass(); }
          }
        }
      }
      obstacles = obstacles.filter((o) => {
        if (o.cull) return false;                        // burst seed pods etc.
        if (o.kind === "hand") return true;              // eternal, until the blink
        if (o.kind === "beam" || o.kind === "block") {
          if (o.mode === "done") return false;
          if (o.kind === "block" && o.rad < R_EYE + 2) { gulp(o.ang); return false; }
          return true;
        }
        if (o.rad < R_EYE + 2) {
          gulp(o.gapAng != null ? Math.random() * TAU : o.ang);
          return false;
        }
        return true;
      });

      // --- pickups ------------------------------------------------------------
      if (introT < 0) {
        dustNext -= wdt;
        if (dustNext <= 0) { spawnDust(v); dustNext = 2.4 + Math.random() * 3; }
        orbNext -= wdt;
        if (orbNext <= 0) {
          if (!shield) spawnOrb(v);
          orbNext = 24 + Math.random() * 18;
        }
        glassNext -= wdt;
        if (glassNext <= 0) {
          if (slowT <= 0) spawnGlass(v);
          glassNext = 30 + Math.random() * 20;
        }
      }
      const mx = polX(ang, rad), my = polY(ang, rad);
      pickups = pickups.filter((pk) => {
        pk.rad -= pk.vr * wdt;
        if (pk.kind === "lure") pk.ang += Math.sin(animT * 1.3 + pk.ph) * 0.2 * wdt;
        const kx = polX(pk.ang, pk.rad), ky = polY(pk.ang, pk.rad);
        if (Math.abs(kx - mx) < 5 && Math.abs(ky - my) < 5) {
          if (pk.kind === "lure") {
            // it was never a mote. The abyss apologizes for nothing.
            if (iframesT > 0) return true;       // brushed while blinking — spared
            hitBy(null);
            toast = "IT LIED"; toastT = 1.2;
            sLie();
            return false;
          }
          if (pk.kind === "orb") {
            shield = true;
            ringFx(mx, my, "#7ef7ff");
            sShield();
            floatText("SHIELD", mx, my - 7, "#7ef7ff");
          } else if (pk.kind === "glass") {
            slowT = 5;
            ringFx(mx, my, "#00eaff");
            sSlow();
            floatText("TIME SLOW", mx, my - 7, "#00eaff");
          } else {
            chain = chainT > 0 ? chain + 1 : 1;
            chainT = 3.5;
            const pts = 10 + Math.min(10, chain) * 5;
            score += pts;
            dustN++;
            sparkleBurst(kx, ky, 5);
            sCollect(chain);
            floatText("+" + pts, kx, ky - 5);
            if (chain > 0 && chain % 5 === 0) { toast = "CHAIN X" + chain; toastT = 1.2; }
          }
          return false;
        }
        return pk.rad > R_EYE + 2;               // the eye eats your treats too
      });

      // collisions — hits knock you into a lower orbit, only the pupil
      // itself actually ends the flight. A shield absorbs one hit.
      // Threading a gap by a wing's width pays.
      if (iframesT <= 0) {
        let wasHit = false;
        for (const o of obstacles) {
          if (collides(o)) {
            hitBy(o);
            wasHit = true;
            break;
          }
        }
        if (!wasHit) {
          for (const o of obstacles) {
            if (o.grazed) continue;
            if (grazes(o)) {
              o.grazed = true;
              score += 8;
              grazeN++;
              sparkleBurst(mx, my, 3);
              floatText("+8", mx, my - 6);
              sGraze();
            }
          }
        }
      }
    }

    // --- the eye: iris, slit pupil, lids — drawn procedurally so it fills
    // whatever square we get. It wanders, it glares, it dilates when fed,
    // and between worlds (and over your corpse) it closes completely.
    function drawEye() {
      const ec = world.eye;
      const irisIn = R_EYE - 3;
      const box = R_EYE + 2;
      const rot = animT * 0.4;
      // ambient blinks ride on top of whatever the lids are doing
      const amb = ambBlinkT > 0 ? Math.sin(Math.PI * (1 - ambBlinkT / 0.36)) : 0;
      const bf = Math.max(blinkF, amb);

      ctx.save();
      ctx.shadowBlur = 0;
      for (let yy = (CY - box) | 0; yy <= CY + box; yy++) {
        for (let xx = (CX - box) | 0; xx <= CX + box; xx++) {
          const dx = xx + 0.5 - CX, dy = yy + 0.5 - CY;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > R_EYE) continue;
          // lids close from above and below (bf 1 = shut)
          if (bf > 0 && Math.abs(dy) > (1 - bf) * R_EYE) {
            ctx.fillStyle = ec.lid;
            ctx.fillRect(xx, yy, 1, 1);
            continue;
          }
          if (d > irisIn) {
            // iris band, with a slowly rotating dash texture
            const a = Math.atan2(dy, dx);
            const seg = ((a + rot) / 0.5) | 0;
            ctx.fillStyle = ec.iris;
            ctx.globalAlpha = seg % 2 ? 1 : 0.75;
            ctx.fillRect(xx, yy, 1, 1);
            ctx.globalAlpha = 1;
          } else {
            ctx.fillStyle = "rgba(10,4,18,0.94)";
            ctx.fillRect(xx, yy, 1, 1);
          }
        }
      }
      // the slit pupil, aimed wherever it is looking
      if (bf < 0.85) {
        const pw = 1 + ((pupilDil * 2.5) | 0);
        const ph = Math.max(2, irisIn - 1);
        const ux = Math.cos(pupilAng + Math.PI / 2), uy = Math.sin(pupilAng + Math.PI / 2);
        ctx.fillStyle = "rgba(0,0,0,0.96)";
        for (let i = -ph; i <= ph; i++) {
          const sx = CX + ux * i * 0.5, sy = CY + uy * i * 0.5;
          ctx.fillRect((sx - pw / 2) | 0, (sy - pw / 2) | 0, pw + 1, pw + 1);
        }
        // a hungry gleam at the center
        ctx.fillStyle = ec.glow;
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(animT * 5) + pupilDil * 0.4;
        ctx.fillRect((CX - 1) | 0, (CY - 1) | 0, 2, 2);
        ctx.globalAlpha = 1;
      }
      // glowing rim so the whole thing reads at a glance
      ctx.shadowColor = ec.iris;
      ctx.shadowBlur = GLOW;
      ctx.fillStyle = ec.iris;
      for (let a = 0; a < 36; a++) {
        const t = (a / 36) * TAU;
        ctx.fillRect(polX(t, R_EYE) | 0, polY(t, R_EYE) | 0, 1, 1);
      }
      ctx.restore();
    }
    function eyeGlowDot() {
      // redrawn after the darkness mask: the gleam never goes out
      const ec = world.eye;
      ctx.save();
      ctx.fillStyle = ec.glow;
      ctx.shadowColor = ec.glow;
      ctx.shadowBlur = GLOW;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(animT * 5);
      ctx.fillRect((CX - 1) | 0, (CY - 1) | 0, 2, 2);
      ctx.restore();
    }

    // --- the gaze, rendered: warning rays, then a sweeping wedge of sight
    function drawGaze() {
      if (gazeMode === "idle") return;
      const ec = world.eye;
      ctx.save();
      if (gazeMode === "warn") {
        if ((animT * 10 | 0) % 2) {
          ctx.strokeStyle = ec.glow;
          ctx.globalAlpha = 0.5;
          for (const off of [-0.45, 0.45]) {
            ctx.beginPath();
            ctx.moveTo(polX(gazeAng + off, R_EYE + 1), polY(gazeAng + off, R_EYE + 1));
            ctx.lineTo(polX(gazeAng + off, R_SPAWN), polY(gazeAng + off, R_SPAWN));
            ctx.stroke();
          }
        }
      } else {
        ctx.globalAlpha = gazedNow ? 0.16 : 0.09;
        ctx.fillStyle = ec.glow;
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.arc(CX, CY, R_SPAWN, gazeAng - 0.45, gazeAng + 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = ec.glow;
        for (const off of [-0.45, 0.45]) {
          ctx.beginPath();
          ctx.moveTo(polX(gazeAng + off, R_EYE + 1), polY(gazeAng + off, R_EYE + 1));
          ctx.lineTo(polX(gazeAng + off, R_SPAWN), polY(gazeAng + off, R_SPAWN));
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // --- the moth, drawn procedurally so it can bank around the circle ----
    function drawMoth() {
      const p = pal();
      const blinkHidden = iframesT > 0 && warpT <= 0 && state === "run" && (animT * 12 | 0) % 2 === 0;
      if (blinkHidden) return;
      let mR = rad, shrink = 1;
      if (state === "over") {
        // spiraling into the pupil, shrinking as it goes
        const t = Math.min(1, (performance.now() - overAt) / 700);
        mR = rad * (1 - t);
        shrink = 1 - t * 0.8;
        if (t >= 1) return;                      // gone
      }
      const mx = polX(ang, mR), my = polY(ang, mR);
      const heading = ang + (aVel >= 0 ? 1 : -1) * Math.PI / 2;
      const hx = Math.cos(heading), hy = Math.sin(heading);
      const px2 = -hy, py2 = hx;                 // perpendicular: wing axis
      const flap = Math.abs(Math.sin(animT * 16)) * 1.6 + 0.6;
      ctx.save();
      ctx.fillStyle = p.fg;
      ctx.shadowColor = p.fg;
      ctx.shadowBlur = GLOW;
      // body: three pixels along the heading
      ctx.fillRect((mx - hx) | 0, (my - hy) | 0, 1, 1);
      ctx.fillRect(mx | 0, my | 0, 2, 2);
      ctx.fillRect((mx + hx * 2) | 0, (my + hy * 2) | 0, 1, 1);
      // wings: pixels out along the perpendicular, flapping
      if (shrink > 0.4) {
        for (const s of [-1, 1]) {
          ctx.fillRect((mx + px2 * s * flap) | 0, (my + py2 * s * flap) | 0, 1, 1);
          ctx.fillRect((mx + px2 * s * (flap + 1.4) - hx * 0.8) | 0,
                       (my + py2 * s * (flap + 1.4) - hy * 0.8) | 0, 1, 1);
        }
      }
      ctx.restore();
      if (shield) {                              // humming halo
        ctx.save();
        ctx.shadowColor = "#7ef7ff";
        ctx.shadowBlur = GLOW;
        ctx.globalAlpha = 0.45 + 0.25 * Math.sin(animT * 6);
        ctx.fillStyle = "#7ef7ff";
        for (let a = 0; a < 10; a++) {
          const t = (a / 10) * TAU + animT;
          ctx.fillRect((mx + Math.cos(t) * 6) | 0, (my + Math.sin(t) * 6) | 0, 1, 1);
        }
        ctx.restore();
      }
    }

    // --- render -----------------------------------------------------------------
    function render() {
      const p = pal();
      ctx.clearRect(0, 0, W, H);           // transparent background
      ctx.save();
      if (shakeT > 0) {
        ctx.translate((Math.random() * 3 - 1) | 0, (Math.random() * 3 - 1) | 0);
      }

      // backdrop: everything falls toward the center, forever
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = p.fg;
      for (const s of stars) {
        ctx.fillRect(polX(s.ang, s.rad) | 0, polY(s.ang, s.rad) | 0, 1, 1);
      }
      if (world.set === "static") {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = p.env;
        for (const b of blips) ctx.fillRect(b.x | 0, b.y | 0, 2, 1);
      }
      ctx.restore();
      // time-slow: tick marks breathe around the rim of the dream
      if (slowT > 0) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(animT * 8);
        ctx.fillStyle = "#00eaff";
        for (let a = 0; a < 12; a++) {
          const t = (a / 12) * TAU;
          ctx.fillRect(polX(t, R_MAX + 1) | 0, polY(t, R_MAX + 1) | 0, 1, 1);
        }
        ctx.restore();
      }

      drawGaze();

      // obstacles
      for (const o of obstacles) {
        if (o.kind === "ring" || o.kind === "chime" || o.kind === "glitchring" || o.kind === "firering") {
          ctx.save();
          const col = o.kind === "firering" ? p.ob : o.kind === "glitchring" ? p.ac : p.env;
          ctx.fillStyle = col;
          ctx.shadowColor = col;
          ctx.shadowBlur = GLOW;
          if (o.kind === "glitchring" && (animT * 14 | 0) % 4 === 0) ctx.globalAlpha = 0.4;
          const step = 1.4 / Math.max(6, o.rad);
          for (let a = 0; a < TAU; a += step) {
            if (Math.abs(angDist(o.gapAng, a)) < o.gapHalf) continue;
            ctx.fillRect(polX(a, o.rad) | 0, polY(a, o.rad) | 0, 1, 2);
          }
          // gap edge ticks, so the way through reads instantly
          for (const s of [-1, 1]) {
            const ga = o.gapAng + s * o.gapHalf;
            ctx.fillStyle = p.ac;
            ctx.fillRect(polX(ga, o.rad - 2) | 0, polY(ga, o.rad - 2) | 0, 2, 2);
          }
          ctx.restore();
        } else if (o.kind === "hand") {
          ctx.save();
          // a faint shadow sweeps ahead of the hand: you always know
          // which way the clock is coming for you
          ctx.globalAlpha = 0.18;
          ctx.fillStyle = p.env;
          const lead1 = o.ang + Math.sign(o.va) * 0.22;
          for (let r = R_EYE + 4; r < R_MAX; r += 4) {
            ctx.fillRect(polX(lead1, r) | 0, polY(lead1, r) | 0, 1, 1);
          }
          ctx.globalAlpha = 1;
          ctx.fillStyle = p.env;
          ctx.shadowColor = p.env;
          ctx.shadowBlur = GLOW;
          for (let r = R_EYE + 2; r < R_MAX; r += 1.5) {
            ctx.fillRect(polX(o.ang, r) | 0, polY(o.ang, r) | 0, 2, 2);
          }
          ctx.fillStyle = p.ac;                          // the arrow tip
          ctx.fillRect(polX(o.ang, R_MAX - 2) | 0, polY(o.ang, R_MAX - 2) | 0, 2, 2);
          ctx.restore();
        } else if (o.kind === "beam") {
          if (o.mode === "warn") {
            if ((animT * 10 | 0) % 2) {
              ctx.save();
              ctx.globalAlpha = 0.5;
              ctx.fillStyle = p.ob;
              for (let r = R_EYE + 2; r < R_MAX; r += 3) {
                ctx.fillRect(polX(o.ang, r) | 0, polY(o.ang, r) | 0, 1, 1);
              }
              ctx.restore();
            }
          } else if (o.mode === "fire") {
            ctx.save();
            ctx.globalAlpha = 0.7 + 0.3 * Math.sin(animT * 40);
            ctx.fillStyle = p.ob;
            ctx.shadowColor = p.ob;
            ctx.shadowBlur = GLOW;
            for (let r = R_EYE + 1; r < R_MAX + 4; r += 1.2) {
              ctx.fillRect((polX(o.ang, r) - 1) | 0, (polY(o.ang, r) - 1) | 0, 3, 3);
            }
            ctx.fillStyle = "#f2f7ff";
            for (let r = R_EYE + 1; r < R_MAX + 4; r += 1.5) {
              ctx.fillRect(polX(o.ang, r) | 0, polY(o.ang, r) | 0, 1, 1);
            }
            ctx.restore();
          }
        } else if (o.kind === "arc") {
          ctx.save();
          ctx.fillStyle = p.ob;
          ctx.shadowColor = p.ob;
          ctx.shadowBlur = GLOW;
          const step = 1.4 / Math.max(6, o.rad);
          for (let a = -o.half; a <= o.half; a += step) {
            ctx.fillRect(polX(o.ang + a, o.rad) | 0, polY(o.ang + a, o.rad) | 0, 1, 2);
          }
          // thorn nubs along the whip
          for (let a = -o.half; a <= o.half; a += o.half) {
            ctx.fillRect(polX(o.ang + a, o.rad - 2) | 0, polY(o.ang + a, o.rad - 2) | 0, 1, 1);
          }
          ctx.restore();
        } else if (o.kind === "block") {
          const bx = polX(o.ang, o.rad), by = polY(o.ang, o.rad);
          if (o.mode === "solid") {
            ctx.save();
            ctx.fillStyle = p.ob;
            ctx.shadowColor = p.ob;
            ctx.shadowBlur = GLOW;
            ctx.fillRect((bx - 2) | 0, (by - 2) | 0, 5, 5);
            ctx.fillStyle = p.ac;
            if ((animT * 8 | 0) % 2) ctx.fillRect(bx | 0, by | 0, 1, 1);
            ctx.restore();
          }
        } else if (o.kind === "gear") {
          const gx = polX(o.ang, o.rad), gy = polY(o.ang, o.rad);
          drawSprite(o.big ? GEAR_B : GEAR_S, gx - (o.w / 2), gy - (o.h / 2), p.ob);
          // a tooth-dot riding the rim sells the rotation
          ctx.save();
          ctx.fillStyle = p.ac;
          ctx.fillRect((gx + Math.cos(o.rot) * (o.w / 2)) | 0, (gy + Math.sin(o.rot) * (o.h / 2)) | 0, 1, 1);
          ctx.restore();
        } else if (o.kind === "petal") {
          drawSprite(PETAL, polX(o.ang, o.rad) - 2, polY(o.ang, o.rad) - 2, p.ac);
        } else if (o.kind === "thorn") {
          // seed pods shiver just before they burst — that's the tell
          const jit = o.split && o.rad < o.split + 6 ? (Math.random() * 2 - 1) : 0;
          drawSprite(THORN, polX(o.ang, o.rad) - 2 + jit, polY(o.ang, o.rad) - 2 - jit, p.ob);
        } else if (o.kind === "spore") {
          drawSprite(SPORE, polX(o.ang, o.rad) - 3, polY(o.ang, o.rad) - 3, p.ob);
        } else if (o.kind === "emberf") {
          drawSprite(EMBERF, polX(o.ang, o.rad) - 1, polY(o.ang, o.rad) - 1, p.ac);
        } else if (o.kind === "bob") {
          const bx = polX(o.ang, o.rad), by = polY(o.ang, o.rad);
          ctx.save();
          ctx.fillStyle = p.ac;
          ctx.shadowColor = p.ac;
          ctx.shadowBlur = GLOW;
          ctx.fillRect((bx - 1) | 0, (by - 1) | 0, 3, 3);
          ctx.globalAlpha = 0.4;                         // hint of the swing arm
          ctx.fillRect(polX(o.base, o.rad + 4) | 0, polY(o.base, o.rad + 4) | 0, 1, 1);
          ctx.restore();
        } else if (o.kind === "bit") {
          ctx.save();
          ctx.fillStyle = p.ac;
          ctx.shadowColor = p.ac;
          ctx.shadowBlur = GLOW;
          ctx.fillRect(polX(o.ang, o.rad) | 0, polY(o.ang, o.rad) | 0, 2, 2);
          ctx.restore();
        }
      }

      // pickups
      for (const pk of pickups) {
        const kx = polX(pk.ang, pk.rad), ky = polY(pk.ang, pk.rad);
        if (pk.kind === "dust") {
          const tw = ((animT * 3 + pk.tw) | 0) % 2;
          if (tw) drawSprite(STAR2, kx - 2, ky - 2, "#ffd23a");
          else drawSprite(STAR1, kx - 1, ky - 1, "#ffd23a");
        } else if (pk.kind === "orb") {
          drawSprite(ORB, kx - 2, ky - 2, "#7ef7ff");
        } else if (pk.kind === "glass") {
          drawSprite(HOURGLASS, kx - 2, ky - 2, "#00eaff");
        } else {
          // the lure: twinkles a beat off, blushes pink, and every other
          // moment you can see the line it hangs from
          const tw = ((animT * 5 + pk.ph) | 0) % 2;
          drawSprite(tw ? STAR2 : STAR1, kx - (tw ? 2 : 1), ky - (tw ? 2 : 1),
            (animT * 2 | 0) % 2 ? "#ffd23a" : "#ff9ad9");
          if ((animT * 4 | 0) % 2) {
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = world.pal.env;
            for (let r = pk.rad - 3; r > R_EYE; r -= 4) {
              ctx.fillRect(polX(pk.ang, r) | 0, polY(pk.ang, r) | 0, 1, 1);
            }
            ctx.restore();
          }
        }
      }

      drawMoth();

      // particle fx
      ctx.save();
      for (const pt of particles) {
        const fade = Math.max(0, pt.ttl / pt.life);
        if (pt.type === "txt") {
          ctx.globalAlpha = fade;
          ctx.shadowBlur = 0;
          drawText(pt.txt, pt.x | 0, pt.y | 0, pt.col);
          continue;
        }
        if (pt.type === "ring") {
          const r = (1 - fade) * 10 + 2;
          ctx.globalAlpha = fade * 0.8;
          ctx.fillStyle = pt.col;
          for (let a = 0; a < 14; a++) {
            const t = (a / 14) * TAU;
            ctx.fillRect((pt.x + Math.cos(t) * r) | 0, (pt.y + Math.sin(t) * r) | 0, 1, 1);
          }
          continue;
        }
        ctx.globalAlpha =
          pt.type === "trail" ? fade * 0.5 :
          pt.type === "sparkle" ? fade * (0.5 + 0.5 * ((animT * 10 | 0) % 2)) :
          pt.type === "swirl" ? fade * 0.8 : fade;
        ctx.fillStyle = pt.col;
        ctx.fillRect(pt.x | 0, pt.y | 0, pt.size, pt.size);
      }
      ctx.restore();

      // the eye is drawn over the moth, so falling to lead 0 reads as
      // being swallowed whole
      drawEye();

      // darkness: keep only a spotlight around the moth (the page behind
      // the canvas is untouched — we mask our own pixels)
      if (world.dark) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-in";
        const mcx = polX(ang, rad), mcy = polY(ang, rad);
        const R = Math.max(40, R_MAX * 0.85);
        const grad = ctx.createRadialGradient(mcx, mcy, R * 0.4, mcx, mcy, R);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(-4, -4, W + 8, H + 8);
        ctx.restore();
        // ...but the eye's gleam never goes out
        eyeGlowDot();
      }

      // it remembers your best flight: as you close in on the record, a
      // golden ring wakes around the iris and burns brighter
      if (state === "run" && !cheatedRun && hiScore > 0 && score < hiScore && hiScore - score < 300) {
        const closeF = 1 - (hiScore - score) / 300;
        ctx.save();
        ctx.globalAlpha = (0.2 + 0.5 * closeF) * (0.6 + 0.4 * Math.sin(animT * 6));
        ctx.fillStyle = "#ffd23a";
        ctx.shadowColor = "#ffd23a";
        ctx.shadowBlur = GLOW;
        for (let a = 0; a < 12; a++) {
          const t = (a / 12) * TAU + animT * 0.5;
          ctx.fillRect(polX(t, R_EYE + 2) | 0, polY(t, R_EYE + 2) | 0, 1, 1);
        }
        ctx.restore();
      }

      // HUD — a square has corners, so the HUD claims them
      const sc = String(score | 0).padStart(5, "0");
      drawText(sc, 3, 3, p.fg);
      if (hiScore > 0) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        const hs = "HI " + String(hiScore).padStart(5, "0");
        drawText(hs, W - textW(hs) - 3, 3, p.env);
        ctx.restore();
      }
      drawText("LV " + level, 3, H - 8, p.env);
      if (dustN > 0) {
        const ds = "*" + dustN;
        drawText(ds, W - textW(ds) - 3, H - 8, p.ac);
      }
      // chain gauge: a sliver under the score draining toward the moment
      // your mote chain expires
      if (state === "run" && chain > 0 && chainT > 0) {
        ctx.save();
        ctx.fillStyle = p.ac;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(3, 10, 12, 2);
        ctx.globalAlpha = 0.9;
        ctx.fillRect(3, 10, Math.max(1, (12 * chainT / 3.5) | 0), 2);
        ctx.restore();
      }

      // active cheats are announced permanently — no stealth cheating
      let badgeY = 12;
      if (immortal) { drawCentered("IMMORTAL", badgeY, p.ac); badgeY += 7; }
      if (turbo) { drawCentered("TURBO", badgeY, p.ac); badgeY += 7; }

      // warp tease: the last level of every world knows the blink is coming
      if (!immortal && !turbo && state === "run" && warpT <= 0 && toastT <= 0 &&
          level % 5 === 0 && (animT * 2 | 0) % 2) {
        drawCentered("BLINK AHEAD", H - 16, p.ac);
      }

      // center messages, in the band above the eye
      if (warpT > 0) {
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(animT * 6);
        drawBlock(["ENTERING"].concat(wrapLines(world.name)), msgY(), p.ac);
        ctx.restore();
      } else if (state === "idle") {
        const alt = (animT / 1.8 | 0) % 2;
        if ((animT * 2 | 0) % 3) {
          drawBlock(wrapLines(alt ? "HOLD TO SPIN TAP TO ACT" : "TAP TO WAKE IT"), msgY(), p.fg);
        }
      } else if (state === "over") {
        let lines = wrapLines("GAME OVER");
        lines = lines.concat(wrapLines("SCORE " + (score | 0)));
        lines = lines.concat(wrapLines("BEST " + hiScore));
        if (dustN > 0) lines = lines.concat(wrapLines("DUST *" + dustN));
        if (grazeN > 0) lines = lines.concat(wrapLines("GRAZE " + grazeN));
        if (newBest) lines = lines.concat(wrapLines("NEW BEST!"));
        drawBlock(lines, msgY(), p.ac);
        if ((animT * 2 | 0) % 2) {
          drawBlock(wrapLines("TAP TO RETRY"), Math.min(H - 10, CY + R_EYE + 10), p.env);
        }
      } else if (toastT > 0 && (animT * 4 | 0) % 2) {
        drawBlock(wrapLines(toast), msgY(), p.ac);
      }

      ctx.restore();
    }

    // --- lifecycle ------------------------------------------------------------
    let rafId = 0, running = false;
    let last = performance.now();
    function loop(now) {
      if (destroyed || !running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt * (turbo ? 10 : 1));      // "sp" cheat: fast-forward everything
      render();
      rafId = requestAnimationFrame(loop);
    }
    function startLoop() {
      if (destroyed || running) return;
      running = true;
      last = performance.now();       // no giant dt after a long pause
      rafId = requestAnimationFrame(loop);
    }
    function stopLoop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    // --- launch button: the only thing in the div until it's clicked ----------
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    Object.assign(btn.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      background: "transparent",
      color: "#ff2e5e",
      border: "1px solid #ff2e5e",
      borderRadius: "999px",              // round, like something watching
      padding: "6px 16px",
      font: "12px monospace",
      letterSpacing: "2px",
      textTransform: "uppercase",
      cursor: "pointer",
      textShadow: "0 0 6px #ff2e5e",
      boxShadow: "0 0 8px rgba(255,46,94,.35), inset 0 0 8px rgba(255,46,94,.15)",
      transition: "box-shadow .15s, background .15s",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(255,46,94,.12)";
      btn.style.boxShadow = "0 0 14px rgba(255,46,94,.6), inset 0 0 10px rgba(255,46,94,.25)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "transparent";
      btn.style.boxShadow = "0 0 8px rgba(255,46,94,.35), inset 0 0 8px rgba(255,46,94,.15)";
    });
    container.appendChild(btn);

    // clicking the button loads the game and wakes the eye right away
    let booted = false, ro = null, io = null;
    function bootAndStart() {
      if (booted || destroyed) return;
      booted = true;
      btn.remove();
      container.appendChild(canvas);
      resize();
      seedScenery();

      if (global.ResizeObserver) {
        ro = new ResizeObserver(resize);
        ro.observe(container);
      } else {
        global.addEventListener("resize", resize);
      }
      // auto-pause: don't burn CPU (or play sounds) while the tile is
      // scrolled out of view; the game freezes and resumes seamlessly
      if (global.IntersectionObserver) {
        io = new IntersectionObserver((entries) => {
          if (entries[entries.length - 1].isIntersecting) {
            startLoop();
          } else {
            stopLoop();
            keyL = false; keyR = false; ptrDown = false; ptrDir = 0;
          }
        });
        io.observe(container);
      } else {
        startLoop();
      }

      reset();
      state = "run";                  // no idle screen on the first time
      canvas.focus({ preventScroll: true });
    }
    btn.addEventListener("click", bootAndStart);

    return {
      get canvas() { return booted ? canvas : null; },
      get score() { return score | 0; },
      get level() { return level; },
      get dust() { return dustN; },
      get grazes() { return grazeN; },
      get world() { return world.name; },
      get state() { return booted ? state : "waiting"; },
      restart() {
        if (destroyed) return;
        if (!booted) { bootAndStart(); return; }
        reset();
        state = "run";
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopLoop();
        btn.remove();
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        else if (booted) global.removeEventListener("resize", resize);
        global.removeEventListener("keydown", onKeyDown);
        global.removeEventListener("keyup", onKeyUp);
        global.removeEventListener("blur", onWinBlur);
        canvas.remove();
        if (audio) { try { audio.close(); } catch (e) {} }
      },
    };
  }

  global.viclops_instance = game_instance;
  if (!global.game_instance) global.game_instance = game_instance;
  if (typeof module !== "undefined" && module.exports) module.exports = game_instance;
})(typeof window !== "undefined" ? window : this);
