/*!
 * Viclanaut — neon pixel climber for tall, narrow strips (40–80px wide).
 *
 * The vertical sibling of Viclasaurus. Where the dinosaur runs sideways
 * through wide gaps in a layout, the astronaut climbs UP through the
 * narrow ones: sidebars, margins, the sliver between two columns.
 *
 * Usage:
 *   <script src="https://your-cdn.com/viclanaut.js"></script>
 *   const div = document.getElementById("column");
 *   const climb = viclanaut_instance(div, "Click me");
 *
 * Nothing is rendered at first except a neon button with your text
 * (second parameter, default "LAUNCH"). Clicking it loads the game,
 * runs the countdown, and lifts off. The canvas covers the whole div
 * (transparent background, so whatever is behind the div shows through).
 *
 * Instance API:
 *   climb.restart()  – reset and launch a fresh ascent
 *   climb.destroy()  – stop the loop, remove listeners and canvas
 *   climb.score / .altitude / .level / .dust / .state / .canvas (read-only)
 *
 * WORLDS — the ascent reinvents itself every 5 levels (smooth warp):
 *   1-5   OPEN SKY      steer: hold a side to lean, tap to dash-step
 *   6-10  THE TEMPEST   bounce: you can never stop — only pick a wall,
 *                       and the wind has opinions about your route
 *   11-15 HIGH ORBIT    drift: zero-g inertia, tap to retro-brake
 *   16-20 THE BELT      steer + darkness, a spotlight in the dust
 *   21-25 THE CORONA    steer + solar flares erupting from the walls
 *   26+   remixes: the cycle repeats faster, darkness creeps everywhere
 *
 * BELOW YOU — the thing that ate your launch pad. A star-wyrm: a ring
 * of rotating teeth that owns the bottom of the strip and devours every
 * obstacle you dodge. Hits don't kill you; they drop you toward the
 * gullet. Climb clean to rebuild your lead. Reach the teeth and it's over.
 *
 * ALSO FALLING FROM ABOVE — stardust (chain it for bonuses), a shield
 * orb now and then, a magnet that hoovers dust toward you, and graze
 * bonuses for dodging by a hair's width. Thunderheads telegraph and then
 * FIRE lightning bolts straight down. Kites swing on their strings. And
 * when you're closing in on your record, a dashed BEST line scrolls
 * down the strip so you can watch yourself beat it.
 *
 * Keyboard is only captured while the pointer is over the game or the
 * game canvas has focus, so it never hijacks the host page.
 */
(function (global) {
  "use strict";

  function game_instance(container, opts) {
    if (!container || !container.appendChild) {
      throw new Error("viclanaut_instance(container): container must be a DOM element");
    }
    if (typeof opts === "string") opts = { label: opts };  // viclanaut_instance(div, "Click me")
    else opts = opts || {};
    var storageKey = opts.storageKey || "viclanaut-hi";
    var label = opts.label || "LAUNCH";

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
    // The WIDTH drives the pixel size (the strip is narrow); the height
    // is whatever the div gives us — vertical room is the whole point.
    let W = 48, H = 240;
    let mawH = 22;                       // how much of the bottom the wyrm owns
    let SAFE_Y = 160, MOUTH_Y = 210, LEAD_SPAN = 50, ARRIVE_Y = 160, eatY = 220;

    const PW = 9, PH = 12;               // the astronaut's pixel box

    function resize() {
      const cw = Math.max(1, container.clientWidth);
      const ch = Math.max(1, container.clientHeight);
      const scale = Math.max(1, Math.round(cw / 48));
      W = Math.max(34, Math.ceil(cw / scale));
      H = Math.max(100, Math.ceil(ch / scale));
      canvas.width = W;
      canvas.height = H;
      mawH = Math.max(15, Math.min(30, (H * 0.09) | 0));
      MOUTH_Y = H - mawH - PH + 4;                    // player top when eaten
      LEAD_SPAN = Math.max(34, Math.min(64, (H * 0.26) | 0));
      SAFE_Y = MOUTH_Y - LEAD_SPAN;                   // player top at full lead
      ARRIVE_Y = SAFE_Y;                              // where fairness is judged
      eatY = H - mawH + 2;                            // past this line, it's food
      ctx.imageSmoothingEnabled = false;
    }

    const GLOW = 3;

    // --- worlds ----------------------------------------------------------
    // pal: fg = astronaut/score, ob = main obstacles, ac = accent
    //      obstacles/toasts, env = walls, gates & backdrop furniture.
    // chase = the wyrm's colors (body / teeth / gullet glow).
    const WORLDS = [
      { set:"sky", name:"OPEN SKY", mech:"steer", dark:false,
        pal:{ fg:"#00eaff", ob:"#ff3ec8", ac:"#ffe94d", env:"#8b6dff" },
        chase:{ body:"#ff2e5e", teeth:"#f2f7ff", glow:"#ffe94d" } },
      { set:"tempest", name:"THE TEMPEST", mech:"bounce", dark:false,
        pal:{ fg:"#ffe94d", ob:"#00eaff", ac:"#ff3ec8", env:"#8b6dff" },
        chase:{ body:"#b26dff", teeth:"#f2f7ff", glow:"#00eaff" } },
      { set:"orbit", name:"HIGH ORBIT", mech:"drift", dark:false,
        pal:{ fg:"#7ef7ff", ob:"#ff7ad9", ac:"#39ff14", env:"#2e86ff" },
        chase:{ body:"#00b3ff", teeth:"#f2f7ff", glow:"#ffe94d" } },
      { set:"belt", name:"THE BELT", mech:"steer", dark:true,
        pal:{ fg:"#c9a7ff", ob:"#ff9d3a", ac:"#39ff14", env:"#7a6dff" },
        chase:{ body:"#ff2e5e", teeth:"#f2f7ff", glow:"#ffe94d" } },
      { set:"corona", name:"THE CORONA", mech:"steer", dark:false,
        pal:{ fg:"#ffd23a", ob:"#ff4d2e", ac:"#ffe94d", env:"#ff6a00" },
        chase:{ body:"#ff6a00", teeth:"#f2f7ff", glow:"#ffe94d" } },
    ];

    // a hint toast fired the moment a warp finishes, because two of the
    // physics switches are rude surprises without one
    const HINTS = {
      sky: "",
      tempest: "NO BRAKES!",
      orbit: "ZERO G TAP TO BRAKE",
      belt: "STAY SHARP IN THE DARK",
      corona: "FLARES FROM THE WALLS",
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
    // The astronaut is seen from behind, climbing away from the viewer:
    // helmet, backpack, arms out, boots dangling over the drop.
    const ASTRO_A = [
      "...###...",
      "..#####..",
      "..##.##..",
      "..#####..",
      "...###...",
      ".#######.",
      "#.#####.#",
      "..#####..",
      "..#####..",
      "...#.#...",
      "...#.#...",
      "..##.##..",
    ];
    const ASTRO_B = [
      "...###...",
      "..#####..",
      "..##.##..",
      "..#####..",
      "...###...",
      ".#######.",
      "#.#####.#",
      "..#####..",
      "..#####..",
      "...#.#...",
      "..#...#..",
      ".##...##.",
    ];
    const ASTRO_L = [
      "..###....",
      ".#####...",
      ".##.##...",
      ".#####...",
      "..###....",
      ".######..",
      "#.####.#.",
      "..#####..",
      "..#####..",
      "...#.#...",
      "...##....",
      "..##.....",
    ];
    const ASTRO_R = [
      "....###..",
      "...#####.",
      "...##.##.",
      "...#####.",
      "....###..",
      "..######.",
      ".#.####.#",
      "..#####..",
      "..#####..",
      "...#.#...",
      "....##...",
      ".....##..",
    ];

    const BIRD_A = [
      "..#.....",
      ".###....",
      "########",
      "..###...",
    ];
    const BIRD_B = [
      "........",
      "#..###..",
      "########",
      ".###....",
    ];
    const BALLOON = [
      ".#####.",
      "#######",
      "#######",
      ".#####.",
      "..###..",
      "...#...",
      "..#.#..",
      "..#.#..",
      "..###..",
    ];
    const THUNDER = [
      "..###.####..",
      ".##########.",
      "############",
      "############",
      ".####.####..",
    ];
    const SAT = [
      "###.###.###",
      "###.#.#.###",
      "###.###.###",
    ];
    const MINE = [
      "..#.#..",
      ".#####.",
      "#######",
      ".#####.",
      "..#.#..",
    ];
    const AST_S = [
      ".###.",
      "#####",
      "#####",
      ".###.",
    ];
    const AST_M = [
      ".#####.",
      "#######",
      "#######",
      "#######",
      ".#####.",
      "..###..",
    ];
    const AST_B = [
      "..#####..",
      ".#######.",
      "#########",
      "#########",
      "#########",
      ".#######.",
      "..#####..",
    ];
    // craters are punched straight through to transparency, so whatever
    // page is behind the strip shows through the rock — free texture
    const CRATERS = { s: [[2, 1]], m: [[2, 1], [4, 3]], b: [[3, 2], [6, 4], [2, 4]] };
    const COMET = [
      ".##.",
      "####",
      ".##.",
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
    const MAG = [
      "#...#",
      "#...#",
      "#...#",
      "##.##",
      ".###.",
    ];
    const KITE = [
      "..#..",
      ".###.",
      "#####",
      ".###.",
      "..#..",
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
    // The narrow strip can't fit long lines, so this build carries the
    // FULL alphabet plus word-wrap — messages stack vertically instead.
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
    // word-wrap a message into lines that fit the strip's width
    function wrapLines(s) {
      const words = String(s).split(" ");
      const lines = [];
      let cur = "";
      for (let i = 0; i < words.length; i++) {
        const t = cur ? cur + " " + words[i] : words[i];
        if (textW(t) <= W - 2) cur = t;
        else { if (cur) lines.push(cur); cur = words[i]; }
      }
      if (cur) lines.push(cur);
      return lines;
    }
    // a centered block of lines around centerY, 7px per line
    function drawBlock(lines, centerY, color) {
      const total = lines.length * 7 - 2;
      let y = (centerY - total / 2) | 0;
      for (let i = 0; i < lines.length; i++) {
        drawCentered(lines[i], y, color);
        y += 7;
      }
    }

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
    const sCount  = () => beep(440, 0.08, "square", 0.03);
    const sLaunch = () => {
      beep(220, 0.12, "square", 0.035);
      setTimeout(() => beep(330, 0.12, "square", 0.035), 90);
      setTimeout(() => beep(494, 0.16, "square", 0.04), 180);
    };
    const sDash   = () => beep(640, 0.05, "square", 0.028);
    const sFlip   = () => beep(520, 0.05, "square", 0.028);
    const sBrake  = () => beep(300, 0.08, "sine", 0.03);
    const sHit    = () => { beep(95, 0.3, "sawtooth", 0.05); beep(180, 0.15, "square", 0.03); };
    const sChomp  = () => beep(150, 0.08, "square", 0.035);
    const sDie    = () => beep(130, 0.25, "sawtooth", 0.04);
    const sGraze  = () => beep(1150, 0.04, "sine", 0.014);
    const sShield = () => { beep(660, 0.09, "sine", 0.035); setTimeout(() => beep(990, 0.12, "sine", 0.035), 80); };
    const sBreakS = () => beep(210, 0.2, "sawtooth", 0.045);
    const sCollect = (chain) => beep(500 + Math.min(9, chain) * 45, 0.06, "square", 0.03);
    const sMile   = () => { beep(740, 0.07, "square", 0.03); setTimeout(() => beep(988, 0.1, "square", 0.03), 80); };
    const sCrackle = () => beep(1250, 0.05, "square", 0.014);
    const sBoom   = () => beep(85, 0.3, "sawtooth", 0.05);
    const sMag    = () => { beep(440, 0.07, "sine", 0.03); setTimeout(() => beep(587, 0.09, "sine", 0.03), 70); };
    const sLevel  = () => { beep(660, 0.08, "square", 0.03); setTimeout(() => beep(880, 0.10, "square", 0.03), 90); };
    const sWarp   = () => {
      beep(330, 0.09, "square", 0.03);
      setTimeout(() => beep(494, 0.09, "square", 0.03), 80);
      setTimeout(() => beep(659, 0.12, "square", 0.03), 160);
      setTimeout(() => beep(880, 0.16, "square", 0.035), 240);
    };
    const sRoar   = () => {
      beep(75, 0.4, "sawtooth", 0.055);
      setTimeout(() => beep(55, 0.5, "sawtooth", 0.05), 120);
    };

    // --- game state ----------------------------------------------------------
    // The wyrm below: hits don't kill, they drop you toward the teeth.
    // `lead` 1..0 is your height above the maw; 0 = eaten. Regenerates
    // while you climb clean.
    const HIT_DAMAGE = 0.4, LEAD_REGEN = 0.045, IFRAMES = 1.2;
    const WARP_TIME = 2.2;
    const LEVEL_TIME = 12;     // every level lasts exactly this many seconds
    const LIFT = 1.05;         // countdown length before liftoff

    let state = "idle";                    // idle | run | over
    let score = 0, hiScore = 0, level = 1, runT = 0;
    let px = 20, py = 100, vx = 0;
    let bounceDir = 1, dashT = 0, dashDir = 1;
    let lead = 1, iframesT = 0, lungeT = 0;
    let obstacles = [], pickups = [], particles = [];
    let motes = [], farStars = [], clouds = [];
    let nextSpawn = 0, dustNext = 3, orbNext = 26;
    let animT = 0, overAt = 0, scrollY = 0;
    let toast = "", toastT = 0, shakeT = 0, chompT = 0, warpT = 0, flashT = 0;
    let roarT = 0, roarNext = 15, rotM = 0;
    let shield = false, chain = 0, chainT = 0, dustN = 0, mileNext = 2000, newBest = false;
    let magT = 0, magNext = 34, recordFired = false;
    let gustT = 0, gustDir = 1, gustNext = 9;
    let hintQ = "";
    // launch cinematic: countdown on the pad, liftoff, the pad falls away
    // below you — and the wyrm rises out of the space where it used to be
    let introT = -1, padY = 0, mawRise = 0, cdStage = 4, lifted = false;

    try { hiScore = +localStorage.getItem(storageKey) || 0; } catch (e) {}

    function speedFor(lvl) { return 96 + (lvl - 1) * 15; }

    function seedScenery() {
      motes = []; farStars = []; clouds = [];
      for (let i = 0; i < H / 14; i++) {
        motes.push({ x: Math.random() * W, y: Math.random() * H });
      }
      for (let i = 0; i < H / 10; i++) {
        farStars.push({ x: Math.random() * W, y: Math.random() * H });
      }
      for (let i = 0; i < 3; i++) {
        clouds.push({ x: Math.random() * (W - 14), y: Math.random() * H, w: 8 + Math.random() * 8 });
      }
    }

    function reset() {
      score = 0; level = 1; runT = 0; scrollY = 0;
      px = ((W - PW) / 2) | 0; py = H - 20 - PH; vx = 0;
      bounceDir = 1; dashT = 0;
      obstacles = []; pickups = []; particles = [];
      nextSpawn = H * 0.8; dustNext = 2.5; orbNext = 24 + Math.random() * 18;
      toast = ""; toastT = 0; shakeT = 0; chompT = 0; warpT = 0; flashT = 0;
      lead = 1; iframesT = 0; lungeT = 0; roarT = 0; roarNext = 12 + Math.random() * 10;
      shield = false; chain = 0; chainT = 0; dustN = 0; mileNext = 2000; newBest = false;
      magT = 0; magNext = 30 + Math.random() * 20; recordFired = false;
      gustT = 0; gustNext = 8 + Math.random() * 6; hintQ = "";
      introT = 0; padY = H - 10; mawRise = 0; cdStage = 4; lifted = false;
      cheatedRun = immortal || turbo;  // starting a run with a cheat on taints it too
      world = WORLDS[0];
    }

    // --- particle fx ---------------------------------------------------------
    function addParticle(p) {
      p.ttl = p.life;
      particles.push(p);
    }
    function puffSmoke(x, y, n) {
      for (let i = 0; i < n; i++) {
        addParticle({
          type: "smoke",
          x: x + Math.random() * 6 - 3, y: y + Math.random() * 3,
          vx: Math.random() * 16 - 8, vy: 4 + Math.random() * 10,
          g: 0, scroll: 0.5,
          size: Math.random() < 0.4 ? 2 : 1,
          life: 0.4 + Math.random() * 0.3,
        });
      }
    }
    function thrustFlame(x, y) {
      addParticle({
        type: "flame", col: Math.random() < 0.5 ? "#ff9d3a" : "#ffe94d",
        x, y, vx: Math.random() * 6 - 3, vy: 30 + Math.random() * 36,
        g: 60, scroll: 0.4, size: 1,
        life: 0.16 + Math.random() * 0.12,
      });
    }
    function wallSpark(x, y, dir) {
      for (let i = 0; i < 4; i++) {
        addParticle({
          type: "spark", col: world.pal.fg,
          x, y: y + Math.random() * 6,
          vx: dir * (10 + Math.random() * 22), vy: Math.random() * 20 - 10,
          g: 90, scroll: 0.6, size: 1,
          life: 0.25 + Math.random() * 0.2,
        });
      }
    }
    function sparkleBurst(x, y, n) {
      for (let i = 0; i < n; i++) {
        addParticle({
          type: "sparkle", col: Math.random() < 0.5 ? "#ffd23a" : "#fff7d0",
          x: x + Math.random() * 4 - 2, y: y + Math.random() * 4 - 2,
          vx: Math.random() * 40 - 20, vy: Math.random() * 40 - 20,
          g: 0, scroll: 0.3, size: 1,
          life: 0.3 + Math.random() * 0.2,
        });
      }
    }
    // gray crunch debris thrown up out of the maw when it eats
    const CHUNK_GRAYS = ["#aab2bd", "#8b939e", "#c8cdd4"];
    function munchBurst() {
      const topY = H - mawH * mawRise + 2;
      for (let i = 0; i < 7; i++) {
        addParticle({
          type: "chunk",
          col: CHUNK_GRAYS[(Math.random() * CHUNK_GRAYS.length) | 0],
          x: W / 2 + Math.random() * 12 - 6, y: topY - Math.random() * 3,
          vx: Math.random() * 30 - 15, vy: -(50 + Math.random() * 60),
          g: 340, scroll: 0,
          size: Math.random() < 0.3 ? 2 : 1,
          life: 0.5 + Math.random() * 0.3,
        });
      }
    }
    function ember(x, y) {
      addParticle({
        type: "flame", col: Math.random() < 0.5 ? "#ff9d3a" : "#ffe94d",
        x, y, vx: Math.random() * 10 - 5, vy: -(20 + Math.random() * 30),
        g: 140, scroll: 0.2, size: 1,
        life: 0.4 + Math.random() * 0.3,
      });
    }
    function spitEmbers() {
      const topY = H - mawH * mawRise + 2;
      for (let i = 0; i < 6; i++) ember(W / 2 + Math.random() * 14 - 7, topY);
    }
    function ringFx(x, y, col) {
      addParticle({ type: "ring", col, x, y, vx: 0, vy: 0, g: 0, scroll: 0, size: 1, life: 0.35 });
    }
    function floatText(txt, x, y, col) {
      addParticle({
        type: "txt", txt, col: col || "#ffd23a",
        x: (x - textW(txt) / 2) | 0, y,
        vx: 0, vy: -13, g: 0, scroll: 0, size: 1, life: 0.8,
      });
    }
    function warpStreak() {
      addParticle({
        type: "streak", col: world.pal.fg,
        x: Math.random() * W, y: -8,
        vx: 0, vy: 300 + Math.random() * 220,
        g: 0, scroll: 0, size: 1,
        life: 0.5 + Math.random() * 0.3,
      });
    }
    function windStreak() {
      addParticle({
        type: "wind", col: world.pal.ac,
        x: gustDir < 0 ? W + 4 : -8, y: Math.random() * (H - mawH),
        vx: gustDir * (130 + Math.random() * 90), vy: Math.random() * 12 - 6,
        g: 0, scroll: 0.2, size: 1,
        life: 0.35 + Math.random() * 0.2,
      });
    }

    // --- fair spawning ----------------------------------------------------
    // Obstacles can fall at different speeds (hail, comets) or hang in
    // the air (balloons, thunderheads), so a fast one spawned above a
    // slow one could reach the astronaut at the same instant — an
    // unwinnable overlap in a strip this narrow. Every new obstacle gets
    // pushed further up until its ARRIVAL TIME is separated from every
    // live obstacle's by more than a full crossing of the strip.
    const MIN_ARRIVAL_SEP = 0.55;          // full-width dodge ~0.45s + margin

    function fairY(desiredY, v, speed) {
      let t = (ARRIVE_Y - desiredY) / v;
      for (let guard = 0; guard < 8; guard++) {
        let bumped = false;
        for (const o of obstacles) {
          const ov = speed + (o.vy || 0);
          if (ov <= 4) continue;
          const ot = (ARRIVE_Y - (o.y + (o.h || 0))) / ov;
          if (Math.abs(t - ot) < MIN_ARRIVAL_SEP) { t = ot + MIN_ARRIVAL_SEP; bumped = true; }
        }
        if (!bumped) break;
      }
      return ARRIVE_Y - t * v;
    }

    // A gate is one dodge: a bar across the strip with a single gap.
    // Only its y is fairness-checked; both halves share it. `nearGapX`
    // couples a second gate to the first so doubles are weaves, not walls.
    function pushGate(desiredY, speed, kind, nearGapX) {
      const gapW = Math.max(PW + 7, ((W * 0.46) | 0) - level);
      let gapX;
      if (nearGapX == null) gapX = 2 + Math.random() * (W - 4 - gapW);
      else gapX = Math.max(2, Math.min(W - 2 - gapW, nearGapX + Math.random() * 24 - 12));
      gapX |= 0;
      const h = kind === "panel" ? 4 : 3;
      const y = desiredY;
      if (gapX > 2) obstacles.push({ kind, x: 0, y, w: gapX, h });
      if (gapX + gapW < W - 2) obstacles.push({ kind, x: gapX + gapW, y, w: W - (gapX + gapW), h });
      return gapX;
    }
    // A flare erupts from one wall and covers most of the width — dodge
    // into the shrinking safe lane on the other side.
    function pushFlare(y, side) {
      const len = Math.max(6, W - Math.max(PW + 7, (W * 0.34) | 0));
      obstacles.push({ kind: "flare", x: side < 0 ? 0 : W - len, y, w: len, h: 4, side });
    }

    // --- per-world spawn tables ----------------------------------------------
    function spawnSky(speed) {
      const roll = Math.random();
      const birdV = 16 + level * 4 + Math.random() * 12;
      if (level >= 2 && roll < 0.34) {
        obstacles.push({
          kind: "bird", x: 1 + Math.random() * (W - 10),
          y: fairY(-8, speed, speed), w: 8, h: 4,
          vx: (Math.random() < 0.5 ? -1 : 1) * birdV,
        });
      } else if (roll < 0.56) {
        const baseX = 5 + Math.random() * (W - 17);
        obstacles.push({
          kind: "balloon", x: baseX, baseX, ph: Math.random() * 6.28,
          y: fairY(-10, speed * 0.78, speed), w: 7, h: 9, vy: -(speed * 0.22),
        });
      } else if (level >= 4 && roll < 0.68) {
        // a lost kite, swinging on its string in wide pendulum arcs
        const amp = 7 + Math.random() * 5;
        const cx = Math.max(amp + 3, Math.min(W - amp - 8, 5 + Math.random() * (W - 10)));
        obstacles.push({
          kind: "kite", cx, amp, ph: Math.random() * 6.28,
          x: cx - 2, y: fairY(-8, speed, speed), w: 5, h: 5,
        });
      } else if (level >= 3 && roll < 0.82) {
        // a flock: two birds crossing from opposite walls, one dodge apart
        const y0 = fairY(-8, speed, speed);
        obstacles.push({ kind: "bird", x: 1, y: y0, w: 8, h: 4, vx: birdV });
        obstacles.push({ kind: "bird", x: W - 9, y: y0 - 30, w: 8, h: 4, vx: -birdV });
      } else {
        // twin balloons flanking the walls — thread the middle
        const y0 = fairY(-10, speed * 0.78, speed);
        obstacles.push({ kind: "balloon", x: 2, baseX: 2, ph: 0, y: y0, w: 7, h: 9, vy: -(speed * 0.22) });
        obstacles.push({ kind: "balloon", x: W - 9, baseX: W - 9, ph: 3, y: y0, w: 7, h: 9, vy: -(speed * 0.22) });
      }
    }

    function spawnTempest(speed) {
      const roll = Math.random();
      if (roll < 0.38) {
        pushGate(fairY(-8, speed, speed), speed, "beam", null);
      } else if (roll < 0.6) {
        // hail volley: fast, small, staggered
        const vyx = 70 + level * 8 + Math.random() * 40;
        const y0 = fairY(-10, speed + vyx, speed);
        const n = 2 + (Math.random() * 2 | 0);
        for (let i = 0; i < n; i++) {
          obstacles.push({
            kind: "hail", x: 2 + Math.random() * (W - 6), y: y0 - i * 9,
            w: 2, h: 2, vy: vyx,
          });
        }
      } else if (roll < 0.8) {
        // a thunderhead hangs in the strip — and it is armed
        obstacles.push({
          kind: "thunder", x: 1 + Math.random() * Math.max(1, W - 14),
          y: fairY(-8, speed * 0.7, speed), w: 12, h: 5, vy: -(speed * 0.3),
          mode: "idle", mt: 1.2 + Math.random() * 1.5,
        });
      } else if (level >= 8) {
        // double gate — a forced weave through two coupled gaps
        const y0 = fairY(-8, speed, speed);
        const g1 = pushGate(y0, speed, "beam", null);
        pushGate(y0 - 32, speed, "beam", g1);
      } else {
        pushGate(fairY(-8, speed, speed), speed, "beam", null);
      }
    }

    function spawnOrbit(speed) {
      const roll = Math.random();
      if (roll < 0.3) {
        if (level >= 12) {
          // a picket line of mines with one hole in it
          const gapW = PW + 8;
          const gapX = (2 + Math.random() * (W - 4 - gapW)) | 0;
          const y = fairY(-10, speed, speed);
          for (let x = gapX - 9; x >= 0; x -= 9) obstacles.push({ kind: "mine", x, y, w: 7, h: 5 });
          for (let x = gapX + gapW + 1; x + 7 <= W - 1; x += 9) obstacles.push({ kind: "mine", x, y, w: 7, h: 5 });
        } else {
          obstacles.push({ kind: "mine", x: 2 + Math.random() * (W - 11), y: fairY(-10, speed, speed), w: 7, h: 5 });
        }
      } else if (roll < 0.55) {
        const fromLeft = Math.random() < 0.5;
        obstacles.push({
          kind: "sat", x: fromLeft ? 1 : W - 12,
          y: fairY(-8, speed, speed), w: 11, h: 3,
          vx: (fromLeft ? 1 : -1) * (18 + level * 3 + Math.random() * 14),
        });
      } else if (roll < 0.75) {
        pushGate(fairY(-8, speed, speed), speed, "panel", null);
      } else {
        obstacles.push({
          kind: "spin", cx: 8 + Math.random() * (W - 16),
          y: fairY(-12, speed, speed), r: 5 + Math.random() * 3,
          ph: Math.random() * 6.28, spd: (Math.random() < 0.5 ? -1 : 1) * (2.2 + Math.random() * 1.4),
          vx: (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 8),
          n: level >= 13 ? 3 : 2, x: 0, w: 0, h: 0,
        });
      }
    }

    function spawnBelt(speed) {
      const roll = Math.random();
      if (roll < 0.42) {
        const r = Math.random();
        const big = r < 0.25 && level >= 17;
        const med = r < 0.6;
        const rows = big ? AST_B : med ? AST_M : AST_S;
        const w = big ? 9 : med ? 7 : 5, h = big ? 7 : med ? 6 : 4;
        obstacles.push({
          kind: "ast", sz: big ? "b" : med ? "m" : "s", rows,
          x: 1 + Math.random() * (W - w - 2), y: fairY(-10, speed, speed), w, h,
          vx: Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (4 + level * 1.5 + Math.random() * 8),
        });
      } else if (roll < 0.64) {
        // a rock shelf jutting from one wall — the pass narrows
        const side = Math.random() < 0.5 ? -1 : 1;
        let w = (W * 0.24 + Math.random() * W * 0.2) | 0;
        w = Math.min(w, W - PW - 9);
        obstacles.push({
          kind: "wall", x: side < 0 ? 0 : W - w,
          y: fairY(-14, speed, speed), w, h: 9 + (Math.random() * 8 | 0),
          seed: (Math.random() * 1000) | 0,
        });
      } else if (roll < 0.8) {
        // twin rocks hugging both walls — thread the middle
        const y0 = fairY(-10, speed, speed);
        obstacles.push({ kind: "ast", sz: "s", rows: AST_S, x: 1, y: y0, w: 5, h: 4, vx: 0 });
        obstacles.push({ kind: "ast", sz: "s", rows: AST_S, x: W - 6, y: y0, w: 5, h: 4, vx: 0 });
      } else {
        obstacles.push({
          kind: "spin", cx: 8 + Math.random() * (W - 16),
          y: fairY(-12, speed, speed), r: 5 + Math.random() * 3,
          ph: Math.random() * 6.28, spd: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 1.2),
          vx: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 6),
          n: 2, x: 0, w: 0, h: 0,
        });
      }
    }

    function spawnCorona(speed) {
      const roll = Math.random();
      if (roll < 0.4) {
        pushFlare(fairY(-8, speed, speed), Math.random() < 0.5 ? -1 : 1);
      } else if (roll < 0.62) {
        const vyx = 46 + level * 4 + Math.random() * 40;
        obstacles.push({
          kind: "comet", x: 2 + Math.random() * (W - 8),
          y: fairY(-8, speed + vyx, speed), w: 4, h: 3,
          vx: (Math.random() < 0.5 ? -1 : 1) * (26 + Math.random() * 40), vy: vyx,
        });
      } else if (roll < 0.8) {
        pushGate(fairY(-8, speed, speed), speed, "beam", null);
      } else {
        // flare double: opposite walls, one dodge apart — a forced S-weave
        const y0 = fairY(-8, speed, speed);
        const side = Math.random() < 0.5 ? -1 : 1;
        pushFlare(y0, side);
        pushFlare(y0 - 32, -side);
      }
    }

    function spawnObstacle(speed) {
      if (world.set === "tempest") spawnTempest(speed);
      else if (world.set === "orbit") spawnOrbit(speed);
      else if (world.set === "belt") spawnBelt(speed);
      else if (world.set === "corona") spawnCorona(speed);
      else spawnSky(speed);
    }

    // --- pickups ---------------------------------------------------------
    // Stardust falls from above in little constellations. Chaining
    // pickups (within 3.5s of each other) is worth more and more.
    function spawnDust() {
      const n = 3 + (Math.random() * 3 | 0);
      const baseX = 4 + Math.random() * (W - 10);
      const kindRoll = Math.random();
      for (let i = 0; i < n; i++) {
        let x = baseX;
        if (kindRoll < 0.4) x = baseX;                                   // column
        else if (kindRoll < 0.7) x = baseX + (i % 2 ? 5 : -5);           // zigzag
        else x = baseX + Math.sin(i * 1.1) * 7;                          // wave
        x = Math.max(2, Math.min(W - 5, x));
        pickups.push({ kind: "dust", x, y: -6 - i * 8, tw: Math.random() * 4 });
      }
    }
    function spawnOrb() {
      const baseX = 3 + Math.random() * (W - 11);
      pickups.push({ kind: "orb", x: baseX, baseX, y: -8, ph: Math.random() * 6.28 });
    }

    // --- input ---------------------------------------------------------------
    // Pointer input is scoped to the canvas: press-and-hold on the left
    // or right half steers that way; a fresh tap is also the "act" verb
    // (dash / flip / retro-brake, depending on the world). Keyboard is
    // scoped to "the pointer is over the game, or the canvas has focus",
    // so the script never steals keys from the host page.
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
        if (introT >= 0 && introT < LIFT) {
          if (introT > 0.15) introT = LIFT;      // skip the countdown
          return;
        }
        const dir = currentDir();
        if (world.mech === "bounce") {
          bounceDir = dir !== 0 ? dir : -bounceDir;
          sFlip();
        } else if (world.mech === "drift") {
          vx *= 0.25;                            // retro-brake
          puffSmoke(px + 1, py + 5, 2);
          puffSmoke(px + PW - 2, py + 5, 2);
          sBrake();
        } else if (dir !== 0) {
          dashDir = dir; dashT = 0.13;           // dash-step
          puffSmoke(px + (dir < 0 ? PW : -1), py + 8, 3);
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
      // capture, so dragging off the (narrow!) strip keeps steering
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      ptrDown = true;
      ptrDir = sideOf(e);
      press();
    };
    const onPointerMove = (e) => { if (ptrDown) ptrDir = sideOf(e); };
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
      if (e.code === "ArrowLeft" || e.code === "KeyA") { e.preventDefault(); keyL = true; }
      if (e.code === "ArrowRight" || e.code === "KeyD") { e.preventDefault(); keyR = true; }
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
      iframesT = IFRAMES; lungeT = 0.5; shakeT = 0.3;
      chain = 0; chainT = 0;                     // a hit breaks the dust chain
      if (lead <= 0) {
        lead = 0; py = MOUTH_Y;                  // dropped into the teeth
        die();
      } else {
        sHit();
      }
    }
    function hitBy(o) {
      o.grazed = true;                           // no graze bonus for a hit
      if (shield) {
        shield = false;
        iframesT = 1.0; shakeT = 0.25;
        ringFx(px + PW / 2, py + PH / 2, "#7ef7ff");
        sBreakS();
      } else {
        applyHit();
      }
    }
    // the wyrm gets everything you dodge
    function munch() {
      munchBurst();
      if (chompT <= 0.05) sChomp();
      chompT = 0.22;
    }

    // spinners hit with their orbiting rocks, firing thunderheads with
    // their bolt column too, everything else with its box
    function boxesOf(o) {
      if (o.kind === "spin") {
        const arr = [];
        for (let k = 0; k < o.n; k++) {
          const a = o.ph + (k * Math.PI * 2) / o.n;
          arr.push({ x: o.cx + Math.cos(a) * o.r - 1, y: o.y + Math.sin(a) * o.r - 1, w: 3, h: 3 });
        }
        return arr;
      }
      if (o.kind === "thunder" && o.mode === "fire") {
        return [o, { x: o.x + 5, y: o.y + 5, w: 2, h: Math.max(0, eatY - (o.y + 5)) }];
      }
      return [o];
    }

    // --- update ----------------------------------------------------------------
    function update(dt) {
      animT += dt;
      if (toastT > 0) toastT -= dt;
      if (shakeT > 0) shakeT -= dt;
      if (iframesT > 0) iframesT -= dt;
      if (lungeT > 0) lungeT -= dt;
      if (chompT > 0) chompT -= dt;
      if (roarT > 0) roarT -= dt;
      if (flashT > 0) flashT -= dt;
      if (chainT > 0) { chainT -= dt; if (chainT <= 0) chain = 0; }
      if (magT > 0) magT -= dt;
      if (warpT > 0) {
        warpT -= dt;
        warpStreak(); warpStreak(); warpStreak();
        if (warpT <= 0 && hintQ) { toast = hintQ; toastT = 1.6; hintQ = ""; }
      }
      if (turbo && Math.random() < dt * 20) warpStreak();
      rotM += dt * (0.5 + (chompT > 0 ? 3 : 0) + (roarT > 0 ? 1 : 0));
      const speed = state === "run" ? speedFor(level) + Math.min(30, score * 0.015) : 24;

      scrollY += speed * dt;             // world-space odometer (belt walls)
      for (const m of motes) {
        m.y += speed * 0.25 * dt;
        if (m.y > H + 2) { m.y = -2; m.x = Math.random() * W; }
      }
      for (const s of farStars) {
        s.y += speed * 0.08 * dt;
        if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; }
      }
      for (const c of clouds) {
        c.y += speed * 0.5 * dt;
        if (c.y > H + 6) { c.y = -8; c.x = Math.random() * Math.max(1, W - c.w); }
      }

      // particle fx keep animating even after death, so bursts finish fading
      for (const pt of particles) {
        pt.ttl -= dt;
        pt.vy += pt.g * dt;
        pt.x += pt.vx * dt;
        pt.y += (pt.vy + speed * pt.scroll) * dt;
      }
      particles = particles.filter((pt) => pt.ttl > 0 && pt.y < H + 10 && pt.x > -12 && pt.x < W + 12);

      if (state !== "run") return;

      if (immortal || turbo) cheatedRun = true;  // any cheated moment taints the run

      // --- launch cinematic: countdown, liftoff, the pad falls away -------
      if (introT >= 0) {
        introT += dt;
        if (introT < LIFT) {
          const stage = 3 - (introT / 0.35 | 0);
          if (stage !== cdStage) { cdStage = stage; sCount(); }
          px += (((W - PW) / 2) - px) * Math.min(1, dt * 10);
          py = padY - PH;
          lead = 1;
          if (Math.random() < dt * 2) puffSmoke(px + 4, padY + 1, 2);
          return;                        // pad-locked: nothing else happens yet
        }
        if (!lifted) {
          lifted = true;
          toast = "LIFTOFF"; toastT = 1;
          puffSmoke(px + 4, padY, 12);
          sLaunch();
        }
        padY += (speed * 1.6 + 90) * dt;
        if (padY > H + 24) {
          mawRise = Math.min(1, mawRise + dt / 0.6);
          if (mawRise >= 1) {
            introT = -1;                 // cinematic over — and it is HUNGRY
            roarT = 0.8; shakeT = 0.3;
            spitEmbers();
            sRoar();
            nextSpawn = Math.min(nextSpawn, 44);
          }
        }
      }

      // lead regenerates while you climb clean; the astronaut eases
      // toward the height their lead has earned
      lead = Math.min(1, lead + LEAD_REGEN * dt);
      const targetY = MOUTH_Y - LEAD_SPAN * lead;
      py += (targetY - py) * Math.min(1, dt * 5);

      // score (altitude), level, and the warp between worlds — every
      // level lasts exactly LEVEL_TIME seconds; only the speed climbs
      score += speed * dt * 0.1;
      runT += dt;
      if (score >= mileNext) {
        toast = mileNext + "M!"; toastT = 1.2;
        sMile();
        mileNext += 2000;
      }
      // sailing past your own record deserves a moment
      if (!recordFired && hiScore > 0 && !cheatedRun && score >= hiScore) {
        recordFired = true;
        toast = "RECORD!"; toastT = 1.4;
        ringFx(px + PW / 2, py + PH / 2, "#ffd23a");
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
          toast = ""; toastT = 0;
          shakeT = 0.25;
          hintQ = HINTS[nw.set] || "";
          if (nw.set === "tempest") flashT = 0.6;           // lightning welcome
          sWarp();
        } else {
          toast = "LEVEL " + level; toastT = 1.4;
          shakeT = 0.2;
          sLevel();
        }
      }

      // the wyrm roars now and then, just to remind you it's there
      if (introT < 0) {
        roarNext -= dt;
        if (roarNext <= 0) {
          roarNext = 10 + Math.random() * 14;
          roarT = 0.7; shakeT = 0.25;
          spitEmbers();
          sRoar();
        }
      }

      // wind gusts (tempest only): streaks give ~half a second of warning
      // before the push actually lands
      let windX = 0;
      if (world.set === "tempest") {
        if (gustT > 0) {
          gustT -= dt;
          if (Math.random() < dt * 40) windStreak();
          if (gustT < 1.4) windX = gustDir * 42;
        } else {
          gustNext -= dt;
          if (gustNext <= 0) {
            gustNext = 7 + Math.random() * 8;
            gustDir = Math.random() < 0.5 ? -1 : 1;
            gustT = 2.0;
          }
        }
      }

      // --- astronaut physics, per world mechanic ---------------------------
      const mech = world.mech;
      const dir = currentDir();

      if (mech === "steer") {
        if (dashT > 0) {
          dashT -= dt;
          vx = dashDir * 150;
        } else {
          const tv = dir * 76;
          vx += (tv - vx) * Math.min(1, dt * 9);
        }
        px += (vx + windX) * dt;
        if (px < 1) { px = 1; if (vx < 0) vx = 0; }
        if (px > W - PW - 1) { px = W - PW - 1; if (vx > 0) vx = 0; }
      } else if (mech === "bounce") {
        if (dir !== 0 && dir !== bounceDir) { bounceDir = dir; sFlip(); }
        const bs = Math.min(86, 52 + level * 1.8);
        vx = bounceDir * bs;
        px += (vx + windX) * dt;
        if (px <= 1) {
          px = 1; bounceDir = 1;
          wallSpark(2, py + 3, 1); sFlip();
        } else if (px >= W - PW - 1) {
          px = W - PW - 1; bounceDir = -1;
          wallSpark(W - 3, py + 3, -1); sFlip();
        }
      } else {                                            // drift: zero-g
        vx += dir * 230 * dt;
        vx = Math.max(-115, Math.min(115, vx));
        px += (vx + windX) * dt;
        if (px < 1) { px = 1; vx = -vx * 0.55; wallSpark(2, py + 3, 1); }
        if (px > W - PW - 1) { px = W - PW - 1; vx = -vx * 0.55; wallSpark(W - 3, py + 3, -1); }
      }

      // the jetpack never stops burning
      if (Math.random() < dt * 24) thrustFlame(px + 3 + Math.random() * 3, py + PH - 1);
      if (Math.random() < dt * 3) puffSmoke(px + 4, py + PH, 1);
      // the corona's walls shed embers
      if (world.set === "corona" && Math.random() < dt * 6) {
        ember(Math.random() < 0.5 ? 1 : W - 2, Math.random() * (H - mawH));
      }

      // --- obstacles ----------------------------------------------------------
      if (introT < 0) {
        nextSpawn -= speed * dt;
        if (nextSpawn <= 0 && warpT <= 0) {
          spawnObstacle(speed);
          const minGap = speed * 0.42 + 22;
          nextSpawn = minGap + Math.random() * (speed * 0.66 + 46);
        }
      }
      for (const o of obstacles) {
        o.y += (speed + (o.vy || 0)) * dt;
        if (o.kind === "bird" || o.kind === "sat" || o.kind === "comet" ||
            (o.kind === "ast" && o.vx)) {
          o.x += o.vx * dt;
          if (o.x < 1) { o.x = 1; o.vx = Math.abs(o.vx); }
          if (o.x > W - o.w - 1) { o.x = W - o.w - 1; o.vx = -Math.abs(o.vx); }
        } else if (o.kind === "balloon") {
          o.x = o.baseX + Math.sin(animT * 1.7 + o.ph) * 3;
        } else if (o.kind === "kite") {
          o.ph += 2.2 * dt;
          o.x = o.cx + Math.sin(o.ph) * o.amp - 2;
        } else if (o.kind === "thunder") {
          // idle → warn (flicker) → FIRE a bolt straight down → idle
          o.mt -= dt;
          if (o.mt <= 0) {
            if (o.mode === "idle" && o.y > 4) {
              o.mode = "warn"; o.mt = 0.5;
              sCrackle();
            } else if (o.mode === "warn") {
              o.mode = "fire"; o.mt = 0.35;
              shakeT = Math.max(shakeT, 0.12);
              sBoom();
            } else if (o.mode === "fire") {
              o.mode = "idle"; o.mt = 2 + Math.random() * 2;
            } else {
              o.mt = 0.3;               // still off-screen: check again soon
            }
          }
        } else if (o.kind === "spin") {
          o.ph += o.spd * dt;
          o.cx += o.vx * dt;
          if (o.cx < o.r + 2) { o.cx = o.r + 2; o.vx = Math.abs(o.vx); }
          if (o.cx > W - o.r - 2) { o.cx = W - o.r - 2; o.vx = -Math.abs(o.vx); }
          o.x = o.cx - o.r - 2; o.w = o.r * 2 + 4;        // rough box for culling
        }
        if (o.kind === "comet" && Math.random() < dt * 30) {
          ember(o.x + 1 + Math.random() * 2, o.y - 1);
        }
        if (o.kind === "flare" && Math.random() < dt * 20) {
          const tipX = o.side < 0 ? o.x + o.w : o.x;
          ember(tipX, o.y + 1 + Math.random() * 2);
        }
      }
      obstacles = obstacles.filter((o) => {
        const top = o.kind === "spin" ? o.y - o.r : o.y;
        if (top > eatY - 3) {
          munch();
          return false;
        }
        return o.x + (o.w || 0) > -14 && o.x < W + 14;
      });

      // --- pickups ------------------------------------------------------------
      if (introT < 0) {
        dustNext -= dt;
        if (dustNext <= 0) { spawnDust(); dustNext = 2.2 + Math.random() * 3; }
        orbNext -= dt;
        if (orbNext <= 0) {
          if (!shield) spawnOrb();
          orbNext = 24 + Math.random() * 18;
        }
        magNext -= dt;
        if (magNext <= 0) {
          if (magT <= 0) {
            const baseX = 3 + Math.random() * (W - 11);
            pickups.push({ kind: "mag", x: baseX, baseX, y: -8, ph: Math.random() * 6.28 });
          }
          magNext = 30 + Math.random() * 20;
        }
      }
      pickups = pickups.filter((pk) => {
        pk.y += speed * dt;
        if (pk.kind === "orb" || pk.kind === "mag") {
          pk.x = pk.baseX + Math.sin(animT * 2 + pk.ph) * 3;
        }
        // an active magnet reels the stardust in
        if (magT > 0 && pk.kind === "dust") {
          const dxm = (px + PW / 2) - pk.x, dym = (py + PH / 2) - pk.y;
          const dm = Math.sqrt(dxm * dxm + dym * dym);
          if (dm < 48 && dm > 1) {
            pk.x += (dxm / dm) * 90 * dt;
            pk.y += (dym / dm) * 90 * dt;
          }
        }
        const s = pk.kind === "dust" ? 3 : 5;
        if (px + PW - 1 > pk.x - 1 && px + 1 < pk.x + s + 1 &&
            py + PH - 1 > pk.y - 1 && py + 1 < pk.y + s + 1) {
          if (pk.kind === "orb") {
            shield = true;
            ringFx(px + PW / 2, py + PH / 2, "#7ef7ff");
            sShield();
            floatText("SHIELD", px + PW / 2, py - 5, "#7ef7ff");
          } else if (pk.kind === "mag") {
            magT = 7;
            ringFx(px + PW / 2, py + PH / 2, "#ff3ec8");
            sMag();
            floatText("MAGNET", px + PW / 2, py - 5, "#ff3ec8");
          } else {
            chain = chainT > 0 ? chain + 1 : 1;
            chainT = 3.5;
            const pts = 10 + Math.min(10, chain) * 5;
            score += pts;
            dustN++;
            sparkleBurst(pk.x + 1, pk.y + 1, 5);
            sCollect(chain);
            floatText("+" + pts, pk.x + 1, pk.y - 4);
            if (chain > 0 && chain % 5 === 0) { toast = "CHAIN X" + chain; toastT = 1.2; }
          }
          return false;
        }
        return pk.y < eatY - 1;                  // the wyrm eats stardust too
      });

      // collisions (AABB with 1px mercy inset) — hits drop you toward the
      // maw, only the teeth themselves actually end the climb. A shield
      // absorbs one hit. Squeaking past by a couple of pixels pays.
      if (iframesT <= 0) {
        const bx = px + 2, by = py + 1, bw = PW - 4, bh = PH - 2;
        let wasHit = false;
        outer:
        for (const o of obstacles) {
          for (const b of boxesOf(o)) {
            if (bx < b.x + b.w - 1 && bx + bw > b.x + 1 &&
                by < b.y + b.h - 1 && by + bh > b.y + 1) {
              hitBy(o);
              wasHit = true;
              break outer;
            }
          }
        }
        if (!wasHit) {
          for (const o of obstacles) {
            if (o.grazed) continue;
            for (const b of boxesOf(o)) {
              if (bx - 2 < b.x + b.w && bx + bw + 2 > b.x &&
                  by - 2 < b.y + b.h && by + bh + 2 > b.y) {
                o.grazed = true;
                score += 8;
                sparkleBurst(px + PW / 2, py + PH / 2, 3);
                floatText("+8", px + PW / 2, py - 4);
                sGraze();
                break;
              }
            }
          }
        }
      }
    }

    // --- the wyrm: a ring of rotating teeth that owns the bottom of the
    // strip, drawn procedurally so it fills whatever width we get. The
    // gullet glows, the teeth grind, and it surges up when it tastes you.
    function drawMaw() {
      if (mawRise <= 0) return;
      const ch = world.chase;
      const R = mawH + 8;
      const cy = H + (R - mawH * mawRise) - (lungeT > 0 ? lungeT * 16 : 0);
      const cx = W / 2;
      let openF = 0.5 + 0.18 * Math.sin(animT * 2.3);     // ambient chewing
      if (roarT > 0) openF = 0.85;                        // roar: wide open
      if (chompT > 0) openF = 0.12;                       // crunch! food
      if (state === "over") openF = 0.06;                 // chomped shut
      const lipR = R - 1.5;
      const gulR = lipR * (0.2 + openF * 0.6);
      const teethN = Math.max(6, (W / 7) | 0);
      const topPix = Math.max(0, (cy - R - 1) | 0);

      ctx.save();
      ctx.shadowBlur = 0;
      for (let yy = topPix; yy < H; yy++) {
        for (let xx = 0; xx < W; xx++) {
          const dx = xx + 0.5 - cx, dy = yy + 0.5 - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > R) continue;
          if (d > lipR) {
            ctx.fillStyle = ch.body;
            ctx.fillRect(xx, yy, 1, 1);
          } else if (d > gulR) {
            const ang = Math.atan2(dy, dx);               // -PI..0 up here
            const u = (ang / Math.PI + 1) * teethN + rotM;
            const frac = u - Math.floor(u);
            const depth = Math.max(0, Math.min(1, (lipR - d) / Math.max(1, lipR - gulR)));
            if (Math.abs(frac - 0.5) < 0.5 * (1 - depth)) {
              ctx.fillStyle = ch.teeth;
              ctx.fillRect(xx, yy, 1, 1);
            } else {
              ctx.fillStyle = "rgba(24,9,38,0.9)";        // inside the mouth
              ctx.fillRect(xx, yy, 1, 1);
            }
          } else {
            ctx.fillStyle = "rgba(14,4,24,0.94)";         // the gullet
            ctx.fillRect(xx, yy, 1, 1);
          }
        }
      }
      // glowing lip ring, drawn on top so the whole maw reads at a glance
      ctx.shadowColor = ch.body;
      ctx.shadowBlur = GLOW;
      ctx.fillStyle = ch.body;
      for (let a = 0; a <= 40; a++) {
        const t = Math.PI + (a / 40) * Math.PI;           // upper half arc
        const lx = cx + Math.cos(t) * (R - 1), ly = cy + Math.sin(t) * (R - 1);
        if (ly >= -1 && ly < H) ctx.fillRect(lx | 0, ly | 0, 1, 1);
      }
      // the light down the throat — always hungry, always pulsing
      ctx.shadowColor = ch.glow;
      ctx.fillStyle = ch.glow;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(animT * 5);
      const gy = Math.min(H - 3, (cy - gulR * 0.55) | 0);
      ctx.fillRect((cx - 1) | 0, gy, 2, 2);
      ctx.restore();
    }
    function mawGlowDot() {
      // redrawn after the darkness mask: the throat-light never goes out
      const ch = world.chase;
      const R = mawH + 8;
      const cy = H + (R - mawH * mawRise);
      const lipR = R - 1.5;
      const openF = state === "over" ? 0.06 : 0.5;
      const gulR = lipR * (0.2 + openF * 0.6);
      ctx.save();
      ctx.fillStyle = ch.glow;
      ctx.shadowColor = ch.glow;
      ctx.shadowBlur = GLOW;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(animT * 5);
      const gy = Math.min(H - 3, (cy - gulR * 0.55) | 0);
      ctx.fillRect(((W / 2) - 1) | 0, gy, 2, 2);
      ctx.restore();
    }

    // --- backdrop: what kind of nothing you're climbing through ------------
    function rnd01(i) {
      const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    }
    function drawBackdrop() {
      const p = pal();
      const spacey = world.set === "orbit" || world.set === "belt" || world.set === "corona";
      ctx.save();
      // far stars appear once the sky runs out (and in every remix)
      if (spacey || level > 25) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "#f2f7ff";
        for (const s of farStars) ctx.fillRect(s.x | 0, s.y | 0, 1, 1);
      }
      // near motes ride the wind in every world
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = p.fg;
      for (const m of motes) ctx.fillRect(m.x | 0, m.y | 0, 1, 1);
      // clouds while there is still air to hold them
      if (world.set === "sky" || world.set === "tempest") {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = p.env;
        for (const c of clouds) {
          ctx.fillRect(c.x | 0, c.y | 0, c.w | 0, 2);
          ctx.fillRect((c.x + 2) | 0, (c.y - 2) | 0, (c.w - 4) | 0, 2);
          ctx.fillRect((c.x + 1) | 0, (c.y + 2) | 0, (c.w - 2) | 0, 1);
        }
      }
      ctx.restore();
      // the belt's rubble walls close in on both sides, scrolling with
      // the world (purely decorative — they never kill)
      if (world.set === "belt") {
        ctx.save();
        ctx.fillStyle = p.env;
        ctx.shadowColor = p.env;
        ctx.shadowBlur = GLOW;
        ctx.globalAlpha = 0.8;
        for (let j = ((scrollY / 4) | 0) - 1; j * 4 - scrollY < H + 4; j++) {
          const sy = (j * 4 - scrollY) | 0;
          if (sy > H - mawH) continue;
          const r = rnd01(j);
          const wl = 1 + ((r * 2.4) | 0) + (r > 0.93 ? 2 : 0);   // odd spur
          ctx.fillRect(0, sy, wl, 4);
          const r2 = rnd01(j * 7.13 + 3.7);
          const wr = 1 + ((r2 * 2.4) | 0) + (r2 > 0.93 ? 2 : 0);
          ctx.fillRect(W - wr, sy, wr, 4);
        }
        ctx.restore();
      }
      // lightning flash when the tempest first swallows you
      if (flashT > 0 && Math.sin(flashT * 30) > 0.2) {
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = "#f2f7ff";
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }

    // --- the launch pad (only exists until the wyrm gets it) ---------------
    function drawPad() {
      if (padY > H + 24) return;
      const p = pal();
      ctx.save();
      ctx.fillStyle = p.env;
      ctx.shadowColor = p.env;
      ctx.shadowBlur = GLOW;
      ctx.fillRect(2, padY | 0, W - 4, 2);
      ctx.fillRect(4, (padY + 2) | 0, 2, 5);
      ctx.fillRect(W - 6, (padY + 2) | 0, 2, 5);
      ctx.fillStyle = p.ac;
      ctx.shadowColor = p.ac;
      for (let x = 4; x < W - 4; x += 5) ctx.fillRect(x, (padY - 1) | 0, 2, 1);
      ctx.restore();
    }

    // --- render -----------------------------------------------------------------
    function render() {
      const p = pal();
      ctx.clearRect(0, 0, W, H);           // transparent background
      ctx.save();
      if (shakeT > 0) {
        ctx.translate((Math.random() * 3 - 1) | 0, (Math.random() * 3 - 1) | 0);
      }

      drawBackdrop();

      // obstacles
      for (const o of obstacles) {
        if (o.kind === "bird") {
          drawSprite((animT * 6 | 0) % 2 ? BIRD_A : BIRD_B, o.x, o.y, p.ob);
        } else if (o.kind === "balloon") {
          drawSprite(BALLOON, o.x, o.y, p.ac);
          ctx.save();
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = p.env;
          ctx.fillRect((o.x + 1) | 0, (o.y + 2) | 0, 5, 1);
          ctx.restore();
        } else if (o.kind === "thunder") {
          drawSprite(THUNDER, o.x, o.y, p.env);
          if (Math.random() < 0.3) {                     // muttering lightning
            ctx.save();
            ctx.fillStyle = p.ob;
            ctx.shadowColor = p.ob;
            ctx.shadowBlur = GLOW;
            ctx.fillRect((o.x + 2 + Math.random() * 8) | 0, (o.y + 1 + Math.random() * 3) | 0, 1, 1);
            ctx.restore();
          }
          if (o.mode === "warn" && (animT * 10 | 0) % 2) {
            // the bolt path flickers before the strike — get out of the lane
            ctx.save();
            ctx.fillStyle = p.ob;
            ctx.shadowColor = p.ob;
            ctx.shadowBlur = GLOW;
            ctx.fillRect((o.x + 5) | 0, (o.y + 6) | 0, 2, 2);
            ctx.globalAlpha = 0.3;
            ctx.fillRect((o.x + 5) | 0, (o.y + 6) | 0, 2, Math.max(0, eatY - (o.y + 6)));
            ctx.restore();
          } else if (o.mode === "fire") {
            ctx.save();
            ctx.globalAlpha = 0.7 + 0.3 * Math.sin(animT * 40);
            ctx.fillStyle = p.ob;
            ctx.shadowColor = p.ob;
            ctx.shadowBlur = GLOW;
            const bh = Math.max(0, eatY - (o.y + 5));
            ctx.fillRect((o.x + 5) | 0, (o.y + 5) | 0, 2, bh);
            ctx.fillStyle = "#f2f7ff";
            ctx.fillRect((o.x + 5) | 0, (o.y + 5) | 0, 1, bh);
            ctx.restore();
          }
        } else if (o.kind === "kite") {
          drawSprite(KITE, o.x, o.y, p.ob);
          ctx.save();                                    // the trailing string
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = p.env;
          const sway = Math.sin(o.ph);
          ctx.fillRect((o.x + 2) | 0, (o.y + 5) | 0, 1, 2);
          ctx.fillRect((o.x + 2 - sway * 2) | 0, (o.y + 7) | 0, 1, 2);
          ctx.fillRect((o.x + 2 - sway * 3) | 0, (o.y + 9) | 0, 1, 2);
          ctx.restore();
        } else if (o.kind === "hail") {
          ctx.save();
          ctx.fillStyle = p.ac;
          ctx.shadowColor = p.ac;
          ctx.shadowBlur = GLOW;
          ctx.fillRect(o.x | 0, o.y | 0, 2, 2);
          ctx.globalAlpha = 0.4;
          ctx.fillRect(o.x | 0, (o.y - 3) | 0, 1, 3);    // speed streak
          ctx.restore();
        } else if (o.kind === "beam") {
          ctx.save();
          ctx.globalAlpha = 0.45 + 0.45 * Math.abs(Math.sin(animT * 8 + o.y));
          ctx.fillStyle = p.ob;
          ctx.shadowColor = p.ob;
          ctx.shadowBlur = GLOW;
          ctx.fillRect(o.x | 0, o.y | 0, o.w, o.h);
          ctx.restore();
        } else if (o.kind === "panel") {
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = p.env;
          ctx.shadowColor = p.env;
          ctx.shadowBlur = GLOW;
          ctx.fillRect(o.x | 0, o.y | 0, o.w, o.h);
          ctx.fillStyle = p.ac;
          ctx.shadowColor = p.ac;
          if ((animT * 4 | 0) % 2) {                     // running lights
            for (let x = o.x + 1; x < o.x + o.w - 1; x += 6) {
              ctx.fillRect(x | 0, (o.y + 1) | 0, 1, 1);
            }
          }
          ctx.restore();
        } else if (o.kind === "flare") {
          ctx.save();
          ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(animT * 10 + o.y));
          ctx.fillStyle = p.ob;
          ctx.shadowColor = p.ob;
          ctx.shadowBlur = GLOW;
          ctx.fillRect(o.x | 0, o.y | 0, o.w, o.h);
          // the plume tapers toward its tip
          const tipX = o.side < 0 ? o.x + o.w : o.x - 2;
          ctx.fillRect(tipX | 0, (o.y + 1) | 0, 2, 2);
          ctx.fillStyle = p.ac;
          ctx.shadowColor = p.ac;
          ctx.fillRect(o.x | 0, (o.y + 1) | 0, o.w, 2);  // white-hot core
          ctx.restore();
        } else if (o.kind === "wall") {
          ctx.save();
          ctx.fillStyle = p.env;
          ctx.shadowColor = p.env;
          ctx.shadowBlur = GLOW;
          ctx.fillRect(o.x | 0, o.y | 0, o.w, o.h);
          ctx.restore();
          for (let i = 0; i < 4; i++) {                  // pocked with holes
            const hx = o.x + 1 + rnd01(o.seed + i) * (o.w - 2);
            const hy = o.y + 1 + rnd01(o.seed + i * 3.7) * (o.h - 2);
            ctx.clearRect(hx | 0, hy | 0, 1, 1);
          }
        } else if (o.kind === "mine") {
          drawSprite(MINE, o.x, o.y, p.ac);
          if ((animT * 3 | 0) % 2) {                     // armed and blinking
            ctx.save();
            ctx.fillStyle = p.fg;
            ctx.shadowColor = p.fg;
            ctx.shadowBlur = GLOW;
            ctx.fillRect((o.x + 3) | 0, (o.y + 2) | 0, 1, 1);
            ctx.restore();
          }
        } else if (o.kind === "sat") {
          drawSprite(SAT, o.x, o.y, p.ob);
          if ((animT * 5 | 0) % 2) {
            ctx.save();
            ctx.fillStyle = p.ac;
            ctx.shadowColor = p.ac;
            ctx.shadowBlur = GLOW;
            ctx.fillRect((o.x + 5) | 0, (o.y + 1) | 0, 1, 1);
            ctx.restore();
          }
        } else if (o.kind === "spin") {
          ctx.save();
          ctx.fillStyle = p.ob;
          ctx.shadowColor = p.ob;
          ctx.shadowBlur = GLOW;
          for (const b of boxesOf(o)) {
            ctx.fillRect(b.x | 0, b.y | 0, 3, 3);
          }
          ctx.globalAlpha = 0.4;
          ctx.fillRect((o.cx - 0.5) | 0, (o.y - 0.5) | 0, 1, 1);   // the hub
          ctx.restore();
        } else if (o.kind === "ast") {
          drawSprite(o.rows, o.x, o.y, p.ob);
          for (const c of CRATERS[o.sz]) {
            ctx.clearRect((o.x + c[0]) | 0, (o.y + c[1]) | 0, 1, 1);
          }
        } else if (o.kind === "comet") {
          drawSprite(COMET, o.x, o.y, p.ac);
        }
      }

      // pickups
      for (const pk of pickups) {
        if (pk.kind === "dust") {
          const tw = ((animT * 3 + pk.tw) | 0) % 2;
          if (tw) drawSprite(STAR2, pk.x - 1, pk.y - 1, "#ffd23a");
          else drawSprite(STAR1, pk.x, pk.y, "#ffd23a");
        } else if (pk.kind === "mag") {
          drawSprite(MAG, pk.x, pk.y, "#ff3ec8");
        } else {
          drawSprite(ORB, pk.x, pk.y, "#7ef7ff");
        }
      }

      drawPad();

      // astronaut (blinks while invulnerable after a hit)
      const blinkHidden = iframesT > 0 && warpT <= 0 && state === "run" && (animT * 12 | 0) % 2 === 0;
      if (!blinkHidden) {
        let frame;
        if (state === "over") frame = ASTRO_A;
        else if (vx < -22) frame = ASTRO_L;
        else if (vx > 22) frame = ASTRO_R;
        else frame = (animT * 8 | 0) % 2 ? ASTRO_A : ASTRO_B;
        drawSprite(frame, px, py, p.fg);
        if (state === "over") {                          // X visor
          ctx.clearRect((px + 3) | 0, (py + 2) | 0, 3, 1);
          ctx.fillStyle = p.fg;
          ctx.fillRect((px + 3) | 0, (py + 2) | 0, 1, 1);
          ctx.fillRect((px + 5) | 0, (py + 2) | 0, 1, 1);
        }
        if (shield) {                                    // humming halo
          ctx.save();
          ctx.shadowColor = "#7ef7ff";
          ctx.shadowBlur = GLOW;
          ctx.globalAlpha = 0.45 + 0.25 * Math.sin(animT * 6);
          ctx.fillStyle = "#7ef7ff";
          const ccx = px + PW / 2, ccy = py + PH / 2;
          for (let a = 0; a < 12; a++) {
            const t = (a / 12) * Math.PI * 2 + animT;
            ctx.fillRect((ccx + Math.cos(t) * 8) | 0, (ccy + Math.sin(t) * 8) | 0, 1, 1);
          }
          ctx.restore();
        }
        if (magT > 0 && state === "run") {               // magnet field, counter-spinning
          ctx.save();
          ctx.shadowColor = "#ff3ec8";
          ctx.shadowBlur = GLOW;
          ctx.globalAlpha = 0.3 + 0.2 * Math.sin(animT * 8) + (magT < 1.5 ? 0.2 * Math.sin(animT * 20) : 0);
          ctx.fillStyle = "#ff3ec8";
          const mcx = px + PW / 2, mcy = py + PH / 2;
          for (let a = 0; a < 6; a++) {
            const t = (a / 6) * Math.PI * 2 - animT * 1.6;
            ctx.fillRect((mcx + Math.cos(t) * 11) | 0, (mcy + Math.sin(t) * 11) | 0, 1, 1);
          }
          ctx.restore();
        }
      }

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
            const t = (a / 14) * Math.PI * 2;
            ctx.fillRect((pt.x + Math.cos(t) * r) | 0, (pt.y + Math.sin(t) * r) | 0, 1, 1);
          }
          continue;
        }
        ctx.globalAlpha =
          pt.type === "smoke" ? fade * 0.55 :
          pt.type === "sparkle" ? fade * (0.5 + 0.5 * ((animT * 10 | 0) % 2)) :
          pt.type === "streak" || pt.type === "wind" ? fade * 0.8 : fade;
        ctx.fillStyle = pt.col || (pt.type === "smoke" ? p.fg : p.env);
        if (pt.type === "streak") ctx.fillRect(pt.x | 0, pt.y | 0, 1, 7);
        else if (pt.type === "wind") ctx.fillRect(pt.x | 0, pt.y | 0, 5, 1);
        else ctx.fillRect(pt.x | 0, pt.y | 0, pt.size, pt.size);
      }
      ctx.restore();

      // the wyrm is drawn over the astronaut, so falling to lead 0 reads
      // as being swallowed by the ring of teeth
      drawMaw();

      // darkness: keep only a spotlight around the astronaut (the page
      // behind the canvas is untouched — we mask our own pixels)
      if (world.dark) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-in";
        const ccx = px + PW / 2, ccy = py + PH / 2;
        // sight reaches well up the strip: obstacles emerge from the
        // dark with real reaction time left
        const R = Math.max(70, H * 0.42);
        const grad = ctx.createRadialGradient(ccx, ccy, R * 0.5, ccx, ccy, R);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(-4, -4, W + 8, H + 8);
        ctx.restore();
        // ...but the throat-light below never goes out
        if (mawRise > 0) mawGlowDot();
      }

      // the record you're chasing, as an actual line in the world — pass
      // it and the game celebrates (10 px of strip per 1 m of altitude)
      if (state === "run" && hiScore > 0 && !cheatedRun && score < hiScore) {
        const my = py - (hiScore - score) * 10;
        if (my > 6 && my < H - mawH) {
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = p.ac;
          ctx.shadowColor = p.ac;
          ctx.shadowBlur = GLOW;
          for (let x = 0; x < W; x += 4) ctx.fillRect(x, my | 0, 2, 1);
          ctx.restore();
          if (my > 14) drawCentered("BEST", (my - 7) | 0, p.ac);
        }
      }

      // HUD (drawn after the mask so it's always readable). The strip is
      // narrow but tall, so the HUD stacks instead of spreading.
      const sc = String(score | 0).padStart(5, "0");
      drawCentered(sc, 3, p.fg);
      drawCentered("LV " + level, 10, p.env);
      if (hiScore > 0) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        drawCentered("HI " + String(hiScore).padStart(5, "0"), 17, p.env);
        ctx.restore();
      }
      if (dustN > 0) drawCentered("*" + dustN, 24, p.ac);

      // chain gauge: a sliver on the right edge draining toward the
      // moment your stardust chain expires
      if (state === "run" && chain > 0 && chainT > 0) {
        ctx.save();
        ctx.fillStyle = p.ac;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(W - 3, 40, 2, 12);
        ctx.globalAlpha = 0.9;
        const gh = Math.max(1, (12 * chainT / 3.5) | 0);
        ctx.fillRect(W - 3, 40 + 12 - gh, 2, gh);
        ctx.restore();
      }

      // active cheats are announced permanently — no stealth cheating
      let badgeY = 31;
      if (immortal) { drawCentered("IMMORTAL", badgeY, p.ac); badgeY += 7; }
      if (turbo) { drawCentered("TURBO", badgeY, p.ac); badgeY += 7; }

      // warp tease: the last level of every world knows something is coming
      if (!immortal && !turbo && state === "run" && warpT <= 0 && toastT <= 0 &&
          level % 5 === 0 && (animT * 2 | 0) % 2) {
        drawCentered("WARP", badgeY, p.ac);
        drawCentered("AHEAD", badgeY + 7, p.ac);
      }

      // countdown, big in the middle of the strip
      if (state === "run" && introT >= 0 && introT < LIFT && cdStage >= 1 && cdStage <= 3) {
        ctx.save();
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(animT * 10);
        drawCentered(String(cdStage), ((H / 2) | 0) - 5, p.ac, 2);
        ctx.restore();
      }

      // center messages
      const cy = Math.max(24, ((H / 2) | 0));
      if (warpT > 0) {
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(animT * 6);
        drawBlock(["ENTERING"].concat(wrapLines(world.name)), cy, p.ac);
        ctx.restore();
      } else if (state === "idle") {
        const alt = (animT / 1.8 | 0) % 2;
        if ((animT * 2 | 0) % 3) {
          drawBlock(wrapLines(alt ? "HOLD A SIDE TAP TO DASH" : "TAP TO LAUNCH"), cy, p.fg);
        }
      } else if (state === "over") {
        let lines = wrapLines("GAME OVER");
        lines.push("");
        lines = lines.concat(wrapLines("ALT " + (score | 0)));
        lines = lines.concat(wrapLines("BEST " + hiScore));
        if (dustN > 0) lines = lines.concat(wrapLines("DUST *" + dustN));
        if (newBest) lines = lines.concat(wrapLines("NEW BEST!"));
        drawBlock(lines, cy - 8, p.ac);
        if ((animT * 2 | 0) % 2) {
          drawBlock(["TAP TO", "RETRY"], Math.min(H - mawH - 12, cy + 26), p.env);
        }
      } else if (toastT > 0 && (animT * 4 | 0) % 2) {
        drawBlock(wrapLines(toast), cy, p.ac);
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
      color: "#ffd23a",
      border: "1px solid #ffd23a",
      borderRadius: "3px",
      padding: "2px 10px",
      font: "12px monospace",
      letterSpacing: "2px",
      textTransform: "uppercase",
      cursor: "pointer",
      writingMode: "vertical-rl",         // the button matches the strip
      textShadow: "0 0 6px #ffd23a",
      boxShadow: "0 0 8px rgba(255,210,58,.35), inset 0 0 8px rgba(255,210,58,.15)",
      transition: "box-shadow .15s, background .15s",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(255,210,58,.12)";
      btn.style.boxShadow = "0 0 14px rgba(255,210,58,.6), inset 0 0 10px rgba(255,210,58,.25)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "transparent";
      btn.style.boxShadow = "0 0 8px rgba(255,210,58,.35), inset 0 0 8px rgba(255,210,58,.15)";
    });
    container.appendChild(btn);

    // clicking the button loads the game and starts the countdown right away
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
      // auto-pause: don't burn CPU (or play sounds) while the strip is
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
      get altitude() { return score | 0; },
      get level() { return level; },
      get dust() { return dustN; },
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

  global.viclanaut_instance = game_instance;
  if (!global.game_instance) global.game_instance = game_instance;
  if (typeof module !== "undefined" && module.exports) module.exports = game_instance;
})(typeof window !== "undefined" ? window : this);
