/*!
 * Viclasaurus — neon pixel runner for wide, short strips (40–80px tall).
 *
 * Usage:
 *   <script src="https://your-cdn.com/viclasaurus.js"></script>
 *   const div = document.getElementById("strip");
 *   const dino_game = game_instance(div, "Click me");
 *
 * Nothing is rendered at first except a neon button with your text
 * (second parameter, default "PLAY"). Clicking it loads the game and
 * starts the first run immediately. The canvas covers the whole div
 * (transparent background, so whatever is behind the div shows through).
 *
 * Instance API:
 *   dino_game.restart()  – reset and start a fresh run
 *   dino_game.destroy()  – stop the loop, remove listeners and canvas
 *   dino_game.score / .level / .state / .canvas (read-only)
 *
 * THE PAGE (4D break-out): clear level 5 and the runner BURSTS OUT of the
 * strip — a full-viewport overlay takes the whole screen and every visible
 * DOM box (headings, buttons, panels, lines of text) becomes a one-way
 * platform. Roam free (Arrows/A-D to move, Space/W/Up to jump, Esc to bail)
 * as neon enemies swarm in. When the chaser finally eats you, you drop back
 * into the strip. This file is the experimental variant; viclasaurus.js is
 * the plain runner.
 *
 * WORLDS — the game reinvents itself every 5 levels (smooth warp):
 *   1-5   THE DESERT       classic: tap jump, hold crouch, fast-fall
 *   6-10  THE DEEP         swim: tap stroke up, hold sink
 *   11-15 THE STORM        jetpack: hold thrust up, release fall
 *   16-20 THE CAVERN       classic + darkness, only a spotlight around you
 *   21-25 THE MOLTEN PATH  classic + lava pits opening in the ground
 *   26+   remixes: the cycle repeats faster, darkness creeps everywhere
 *
 * Keyboard is only captured while the pointer is over the game or the
 * game canvas has focus, so it never hijacks the host page.
 */
(function (global) {
  "use strict";

  function game_instance(container, opts) {
    if (!container || !container.appendChild) {
      throw new Error("game_instance(container): container must be a DOM element");
    }
    if (typeof opts === "string") opts = { label: opts };   // game_instance(div, "Click me")
    else opts = opts || {};
    var storageKey = opts.storageKey || "viclasaurus-hi";
    var label = opts.label || "PLAY";

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
    let W = 320, H = 40, groundY = 34;

    function resize() {
      const cw = Math.max(1, container.clientWidth);
      const ch = Math.max(1, container.clientHeight);
      const scale = Math.max(1, Math.round(ch / 48));
      W = Math.max(120, Math.ceil(cw / scale));
      H = Math.max(30, Math.ceil(ch / scale));
      canvas.width = W;
      canvas.height = H;
      groundY = H - 5;
      ctx.imageSmoothingEnabled = false;
    }

    const GLOW = 3;

    // --- worlds ----------------------------------------------------------
    // pal: fg = dino/score, ob = main obstacles, ac = accent obstacles/toasts,
    //      ground = floor & pebbles. chase = the big head's colors.
    const WORLDS = [
      { set:"desert", name:"THE DESERT", mech:"run", dark:false, pits:false,
        pal:{ fg:"#00eaff", ob:"#39ff14", ac:"#ff3ec8", ground:"#8b6dff" },
        chase:{ body:"#ff2e5e", teeth:"#f2f7ff", eye:"#ffe94d", lure:false } },
      { set:"deep", name:"THE DEEP", mech:"swim", dark:false, pits:false,
        pal:{ fg:"#7ef7ff", ob:"#ff7ad9", ac:"#ffe94d", ground:"#2e86ff" },
        chase:{ body:"#00b3ff", teeth:"#f2f7ff", eye:"#ffe94d", lure:true } },
      { set:"storm", name:"THE STORM", mech:"fly", dark:false, pits:false,
        pal:{ fg:"#ffe94d", ob:"#ff3ec8", ac:"#00eaff", ground:"#8b6dff" },
        chase:{ body:"#b26dff", teeth:"#f2f7ff", eye:"#00eaff", lure:false } },
      { set:"cavern", name:"THE CAVERN", mech:"run", dark:true, pits:false,
        pal:{ fg:"#c9a7ff", ob:"#39ff14", ac:"#ff9d3a", ground:"#7a6dff" },
        chase:{ body:"#ff2e5e", teeth:"#f2f7ff", eye:"#ffe94d", lure:false } },
      { set:"molten", name:"THE MOLTEN PATH", mech:"run", dark:false, pits:true,
        pal:{ fg:"#ffd23a", ob:"#39ff14", ac:"#ff4d2e", ground:"#ff6a00" },
        chase:{ body:"#ff6a00", teeth:"#f2f7ff", eye:"#ffe94d", lure:false } },
    ];

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
    const DINO_BODY = [
      "........#####.",
      "........#.###.",
      "........#####.",
      "........###...",
      "........#####.",
      "#......###....",
      "#.....#####...",
      "##...######.#.",
      "##..#######.#.",
      "###########...",
      ".##########...",
      "..########....",
    ];
    const DINO_RUN_A = DINO_BODY.concat(["...##...#.....", "...#....##...."]);
    const DINO_RUN_B = DINO_BODY.concat(["...#....##....", "...##........."]);
    const DINO_JUMP  = DINO_BODY.concat(["...#....#.....", "...#....#....."]);
    const DINO_W = 14, DINO_H = 14;

    const DINO_CROUCH_A = [
      "..............######",
      "..............#.####",
      "#.............######",
      "##...........####...",
      "###.#############.#.",
      ".################...",
      "..##############....",
      "...##...##..........",
      "...#.....#..........",
    ];
    const DINO_CROUCH_B = [
      "..............######",
      "..............#.####",
      "#.............######",
      "##...........####...",
      "###.#############.#.",
      ".################...",
      "..##############....",
      "...#....##..........",
      "...##...............",
    ];
    const CROUCH_W = 20, CROUCH_H = 9;

    const CACTUS_S = [
      "..##..",
      "..##..",
      "#.##..",
      "#.##.#",
      "#.##.#",
      "####.#",
      "..####",
      "..##..",
      "..##..",
      "..##..",
    ];
    const CACTUS_B = [
      "...##...",
      "...##...",
      "#..##...",
      "#..##..#",
      "#..##..#",
      "#..##..#",
      "####...#",
      "...#####",
      "...##...",
      "...##...",
      "...##...",
      "...##...",
    ];
    const BIRD_A = [
      "....#.......",
      "....##......",
      "....###.....",
      "#.########..",
      "##########..",
      "..######....",
    ];
    const BIRD_B = [
      "............",
      "#.#.........",
      "##.#####....",
      "##########..",
      "..######....",
      "....###.....",
    ];
    const JELLY_A = [
      ".######.",
      "########",
      "########",
      "#.#..#.#",
      ".#.##.#.",
      "#..##..#",
    ];
    const JELLY_B = [
      ".######.",
      "########",
      "########",
      ".#.##.#.",
      "#.#..#.#",
      ".#.##.#.",
    ];
    const MINE = [
      "..#.#..",
      ".#####.",
      "#######",
      ".#####.",
      "..#.#..",
    ];
    const MISSILE = [
      "..#######.",
      "##########",
      "..#######.",
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
      "9":"111101111001111","A":"111101111101101","C":"111100100100111",
      "D":"110101101101110","E":"111100111100111","G":"111100101101111",
      "H":"101101111101101","I":"111010010010111","J":"001001001101111",
      "K":"101101110101101","L":"100100100100111","M":"101111111101101",
      "N":"110101101101101","O":"111101101101111","P":"111101111100100",
      "R":"111101110101101","S":"111100111001111","T":"111010010010010",
      "U":"101101101101111","V":"101101101101010","W":"101101101111101",
      "Y":"101101010010010","!":"010010010000010"," ":"000000000000000",
    };
    function textW(s) { return s.length * 4 - 1; }
    function drawText(s, x, y, color) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = GLOW;
      for (let i = 0; i < s.length; i++) {
        const g = FONT[s[i]] || FONT[" "];
        for (let b = 0; b < 15; b++) {
          if (g[b] === "1") ctx.fillRect(x + i * 4 + (b % 3), y + (b / 3 | 0), 1, 1);
        }
      }
      ctx.restore();
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
    const sJump  = () => beep(600, 0.07, "square", 0.03);
    const sSwim  = () => beep(420, 0.06, "sine", 0.035);
    const sDuck  = () => beep(300, 0.05, "square", 0.02);
    const sHit   = () => { beep(95, 0.3, "sawtooth", 0.05); beep(180, 0.15, "square", 0.03); };
    const sChomp = () => beep(150, 0.08, "square", 0.035);
    const sDie   = () => beep(130, 0.25, "sawtooth", 0.04);
    const sLevel = () => { beep(660, 0.08, "square", 0.03); setTimeout(() => beep(880, 0.10, "square", 0.03), 90); };
    const sWarp  = () => {
      beep(330, 0.09, "square", 0.03);
      setTimeout(() => beep(494, 0.09, "square", 0.03), 80);
      setTimeout(() => beep(659, 0.12, "square", 0.03), 160);
      setTimeout(() => beep(880, 0.16, "square", 0.035), 240);
    };

    // --- game state ----------------------------------------------------------
    const GRAVITY = 700, JUMP_V = -152, FASTFALL = 2.8;
    // The chaser: hits don't kill, they knock you back toward the jaws.
    // `lead` 1..0 is your distance; 0 = eaten. Regenerates while clean.
    const SAFE_X = 56, MOUTH_X = 8;
    const HIT_DAMAGE = 0.4, LEAD_REGEN = 0.045, IFRAMES = 1.2;
    const WARP_TIME = 2.2;
    const LEVEL_TIME = 12;     // every level lasts exactly this many seconds

    let state = "idle";                    // idle | run | over
    let score = 0, hiScore = 0, level = 1, runT = 0;
    let dinoY = 0, dinoVY = 0, onGround = true;
    let dinoX = SAFE_X, lead = 1, iframesT = 0, lungeT = 0;
    let crouchHeld = false, wasCrouch = false, crouchLatch = false, jumpHeld = false;
    let obstacles = [], pebbles = [], sparks = [], particles = [];
    let nextSpawn = 0, animT = 0, overAt = 0, jumpBuffer = 0, scrollX = 0;
    let toast = "", toastT = 0, shakeT = 0, chompT = 0, warpT = 0;
    // dive-into-the-deep cinematic: the land runs out, the dino drops off
    // the edge, and the old floor slides UP off the screen — a fake
    // camera-pan-down; the camera never actually moves
    let introT = -1, introPanY = 0, introEdgeX = 0, introC = "#8b6dff", introSplash = true;

    // --- THE PAGE (the "4D" break-out): at level 6 the runner bursts out of
    // the strip and platforms across the real DOM — every visible box
    // (headings, buttons, panels, lines of text) becomes a one-way ledge —
    // while neon enemies swarm in. It roams free (arrows + jump) until the
    // chaser eats it, then it drops back into the strip. A second,
    // full-viewport fixed canvas owns this whole mode. ----------------------
    let escapeUsed = false, escaping = false, escapeT = 0;
    let pageMode = false, pageCanvas = null, pctx = null;
    let pvw = 0, pvh = 0, pdpr = 1, PX = 4, pFade = 0, pFadeTarget = 1;
    let plats = [], platScanT = 0;
    let ppx = 0, ppy = 0, pvx = 0, pvy = 0, pPrevFeet = 0;
    let pOnGround = false, pFacing = 1, pCoyote = 0, pJumpBuf = 0;
    let pMoveL = false, pMoveR = false;
    let pEnemies = [], pSpawnT = 0, pParticles = [];
    let pLead = 1, pIfr = 0, pDying = false, pDieT = 0;
    let pOnResize = null, pOnScroll = null;

    try { hiScore = +localStorage.getItem(storageKey) || 0; } catch (e) {}

    function speedFor(lvl) { return 115 + (lvl - 1) * 20; }

    function seedScenery() {
      pebbles = []; sparks = [];
      for (let x = 0; x < W; x += 8 + Math.random() * 30) {
        pebbles.push({ x, y: groundY + 2 + Math.random() * 2, w: 1 + (Math.random() * 2 | 0) });
      }
      for (let i = 0; i < W / 12; i++) {
        sparks.push({ x: Math.random() * W, y: Math.random() * Math.max(6, groundY - 8) });
      }
    }

    function reset() {
      score = 0; level = 1; runT = 0; scrollX = 0;
      dinoY = 0; dinoVY = 0; onGround = true;
      obstacles = []; particles = []; nextSpawn = W * 0.6; jumpBuffer = 0;
      toast = ""; toastT = 0; shakeT = 0; chompT = 0; warpT = 0;
      dinoX = SAFE_X; lead = 1; iframesT = 0; lungeT = 0;
      crouchLatch = false; introT = -1;
      if (pageCanvas) unmountOverlay();               // scrap any leftover break-out
      pageMode = false; escaping = false; escapeUsed = false;
      pMoveL = false; pMoveR = false; pDying = false;
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
          x: x + Math.random() * 8 - 3, y: y - Math.random() * 3,
          vx: -4 - Math.random() * 10, vy: -6 - Math.random() * 10,
          g: -12, scroll: 0.35,
          size: Math.random() < 0.4 ? 2 : 1,
          life: 0.4 + Math.random() * 0.3,
        });
      }
    }
    function kickRocks(x, y, n, impact) {
      for (let i = 0; i < n; i++) {
        addParticle({
          type: "rock",
          x: x + Math.random() * 10 - 3, y: y - 1,
          vx: (Math.random() * 2 - 1) * 34, vy: -(24 + Math.random() * impact * 0.2),
          g: 420, scroll: 1,
          size: Math.random() < 0.25 ? 2 : 1,
          life: 0.45 + Math.random() * 0.3,
        });
      }
    }
    // gray crunch debris sprayed from the chaser's mouth when it eats
    const CHUNK_GRAYS = ["#aab2bd", "#8b939e", "#c8cdd4"];
    function munchBurst() {
      const mouthY = 2 + Math.max(6, (groundY * 0.42) | 0) + 2;
      for (let i = 0; i < 8; i++) {
        addParticle({
          type: "chunk",
          col: CHUNK_GRAYS[(Math.random() * CHUNK_GRAYS.length) | 0],
          x: 8 + Math.random() * 8, y: mouthY + Math.random() * 6 - 2,
          vx: 14 + Math.random() * 40, vy: -26 + Math.random() * 30,
          g: 320, scroll: 0.25,
          size: Math.random() < 0.3 ? 2 : 1,
          life: 0.45 + Math.random() * 0.3,
        });
      }
    }
    function bubble(x, y) {
      addParticle({
        type: "bubble", col: "#bfefff",
        x, y, vx: Math.random() * 6 - 3, vy: -14 - Math.random() * 10,
        g: 0, scroll: 0.5, size: 1,
        life: 0.5 + Math.random() * 0.5,
      });
    }
    function flame(x, y) {
      addParticle({
        type: "flame", col: Math.random() < 0.5 ? "#ff9d3a" : "#ffe94d",
        x, y, vx: -6 - Math.random() * 8, vy: 24 + Math.random() * 22,
        g: -30, scroll: 0.6, size: 1,
        life: 0.18 + Math.random() * 0.12,
      });
    }
    function lavaSplash(x, y) {
      for (let i = 0; i < 8; i++) {
        addParticle({
          type: "rock", col: Math.random() < 0.6 ? "#ff6a00" : "#ffe94d",
          x: x + Math.random() * 8 - 2, y: y - 1,
          vx: (Math.random() * 2 - 1) * 30, vy: -(30 + Math.random() * 40),
          g: 380, scroll: 1, size: 1,
          life: 0.4 + Math.random() * 0.3,
        });
      }
    }
    function warpStreak() {
      addParticle({
        type: "streak", col: world.pal.fg,
        x: W + 4, y: Math.random() * H,
        vx: -(300 + Math.random() * 220), vy: 0,
        g: 0, scroll: 0, size: 1,
        life: 0.5 + Math.random() * 0.3,
      });
    }

    // --- fair spawning ----------------------------------------------------
    // Obstacles can travel at different speeds (birds, missiles), so a fast
    // one spawned behind a slow one could arrive at the dino at the same
    // instant — an unwinnable overlap. Every new obstacle gets pushed back
    // until its ARRIVAL TIME is separated from every live obstacle's by
    // more than a full jump.
    const MIN_ARRIVAL_SEP = 0.55;              // jump airtime ~0.43s + margin
    const ARRIVE_X = SAFE_X + 18;

    function fairX(desiredX, v, speed) {
      let t = (desiredX - ARRIVE_X) / v;
      for (let guard = 0; guard < 8; guard++) {
        let bumped = false;
        for (const o of obstacles) {
          const ot = (o.x + o.w - ARRIVE_X) / (speed + (o.vx || 0));
          if (Math.abs(t - ot) < MIN_ARRIVAL_SEP) { t = ot + MIN_ARRIVAL_SEP; bumped = true; }
        }
        if (!bumped) break;
      }
      return ARRIVE_X + t * v;
    }

    // Bird altitudes (relative to ground):
    //   low    y=g-10 : jump over it
    //   crouch y=g-17 : hits standing AND jumping — you MUST crouch
    //   high   y=g-26 : cruises over your head — do NOT jump into it
    function pushBird(desiredX, mode, extraV, speed) {
      const y = mode === "high" ? groundY - 26 : mode === "crouch" ? groundY - 17 : groundY - 10;
      const x = fairX(desiredX, speed + extraV, speed);
      obstacles.push({ kind: "bird", x, y, w: 10, h: 6, vx: extraV });
    }
    // A cluster (double/triple cactus) is one jumpable unit: only its base
    // position is fairness-checked, members keep their fixed offsets.
    function pushCactusCluster(desiredX, speed, parts) {
      const x0 = fairX(desiredX, speed, speed);
      for (const part of parts) {
        if (part.big) obstacles.push({ kind: "cactus", x: x0 + part.dx, y: groundY - 12, w: 8, h: 12, rows: CACTUS_B });
        else          obstacles.push({ kind: "cactus", x: x0 + part.dx, y: groundY - 10, w: 6, h: 10, rows: CACTUS_S });
      }
    }

    // --- per-world spawn tables ----------------------------------------------
    function spawnDesert(speed) {
      const roll = Math.random();
      const birdV = 14 + level * 6 + Math.random() * 20;
      const canHigh = groundY >= 30;

      if (level >= 2 && roll < 0.40) {
        const r = Math.random();
        if (r < 0.45) pushBird(W + 12, "crouch", birdV, speed);
        else if (r < 0.75 || !canHigh) pushBird(W + 12, "low", birdV, speed);
        else pushBird(W + 12, "high", birdV, speed);
      } else if (level >= 3 && roll < 0.58) {
        pushCactusCluster(W + 8, speed, [{ dx: 0, big: false }]);
        pushBird(W + 34 + Math.random() * 14, Math.random() < 0.6 ? "crouch" : "low", birdV, speed);
      } else if (roll < 0.72) {
        const parts = [{ dx: 0, big: Math.random() < 0.4 }];
        if (level >= 2 && Math.random() < 0.5) parts.push({ dx: 7, big: false });
        if (level >= 4 && Math.random() < 0.4) parts.push({ dx: 14, big: false });
        pushCactusCluster(W + 8, speed, parts);
      } else {
        const parts = [{ dx: 0, big: true }];
        if (level >= 3 && Math.random() < 0.35) parts.push({ dx: 9, big: false });
        pushCactusCluster(W + 8, speed, parts);
      }
    }

    function spawnDeep(speed) {
      const roll = Math.random();
      const B = H - 6;                 // open water: no floor, use full height
      const freeY = (h) => 3 + Math.random() * Math.max(4, B - 3 - h);
      if (roll < 0.45) {
        obstacles.push({
          kind: "jelly", x: fairX(W + 12, speed + 12, speed),
          baseY: freeY(6), y: 0, bob: 3 + Math.random() * 5, ph: Math.random() * 6.28,
          w: 8, h: 6, vx: 8 + Math.random() * 12,
        });
      } else if (roll < 0.72 || H < 40) {
        obstacles.push({ kind: "mine", x: fairX(W + 10, speed, speed), y: freeY(5), w: 7, h: 5, vx: 0 });
      } else {
        // vertical mine pair — thread the gap between them
        const x0 = fairX(W + 10, speed, speed);
        const gap = 17;
        const span = B - 3 - (10 + gap);
        const y1 = 3 + Math.random() * Math.max(2, span);
        obstacles.push({ kind: "mine", x: x0, y: y1, w: 7, h: 5, vx: 0 });
        obstacles.push({ kind: "mine", x: x0, y: y1 + 5 + gap, w: 7, h: 5, vx: 0 });
      }
    }

    function spawnStorm(speed) {
      const roll = Math.random();
      const gate = (x0, nearY) => {
        const gapH = 18 + Math.random() * 6;
        let gapY = 4 + Math.random() * Math.max(2, groundY - 8 - gapH);
        if (nearY != null) gapY = Math.max(2, Math.min(groundY - 6 - gapH, nearY + Math.random() * 20 - 10));
        obstacles.push({ kind: "laser", x: x0, y: 0, w: 3, h: gapY, vx: 0 });
        obstacles.push({ kind: "laser", x: x0, y: gapY + gapH, w: 3, h: Math.max(2, groundY - (gapY + gapH)), vx: 0 });
        return gapY;
      };
      if (roll < 0.5) {
        gate(fairX(W + 10, speed, speed), null);
      } else if (roll < 0.85) {
        const vx = 60 + level * 3 + Math.random() * 40;
        obstacles.push({
          kind: "missile", x: fairX(W + 90, speed + vx, speed),
          y: 4 + Math.random() * Math.max(4, groundY - 12), w: 10, h: 3, vx,
        });
      } else {
        // double gate — thread two gaps in a row
        const x0 = fairX(W + 10, speed, speed);
        const g1 = gate(x0, null);
        gate(x0 + 26, g1);
      }
    }

    function spawnCavern(speed) {
      const roll = Math.random();
      const birdV = 14 + level * 4 + Math.random() * 16;
      if (roll < 0.30) {
        // stalactite: fills the air down to crouch height — you MUST crouch
        obstacles.push({ kind: "stal", x: fairX(W + 8, speed, speed), y: 0, w: 6, h: Math.max(6, groundY - 11), vx: 0 });
      } else if (roll < 0.58) {
        pushBird(W + 12, Math.random() < 0.5 ? "crouch" : "low", birdV, speed);
      } else {
        const parts = [{ dx: 0, big: Math.random() < 0.4 }];
        if (Math.random() < 0.4) parts.push({ dx: 7, big: false });
        pushCactusCluster(W + 8, speed, parts);
      }
    }

    function spawnMolten(speed) {
      const roll = Math.random();
      const birdV = 14 + level * 4 + Math.random() * 16;
      if (roll < 0.35) {
        obstacles.push({ kind: "pit", x: fairX(W + 8, speed, speed), y: groundY, w: 16 + Math.random() * 14, h: 2, vx: 0 });
      } else if (roll < 0.6) {
        const parts = [{ dx: 0, big: Math.random() < 0.4 }];
        if (Math.random() < 0.4) parts.push({ dx: 7, big: false });
        pushCactusCluster(W + 8, speed, parts);
      } else if (roll < 0.8) {
        pushBird(W + 12, Math.random() < 0.5 ? "low" : "crouch", birdV, speed);
      } else {
        pushCactusCluster(W + 8, speed, [{ dx: 0, big: true }]);
      }
    }

    function spawnObstacle(speed) {
      if (world.set === "deep") spawnDeep(speed);
      else if (world.set === "storm") spawnStorm(speed);
      else if (world.set === "cavern") spawnCavern(speed);
      else if (world.set === "molten") spawnMolten(speed);
      else spawnDesert(speed);
    }

    // --- input ---------------------------------------------------------------
    // Pointer input is scoped to the canvas. Keyboard is scoped to
    // "the pointer is over the game, or the canvas has focus", so the
    // script never steals Space/arrows from the host page.
    let hovered = false, focused = false, destroyed = false;
    // testing cheats: type "jp" = immortality, "sp" = 5x speed.
    // Both are displayed on screen and disqualify the run from hi-scores.
    let immortal = false, turbo = false, cheatBuf = "", cheatedRun = false;

    function press() {
      if (state === "idle") {
        reset(); state = "run"; sJump();
      } else if (state === "run") {
        jumpBuffer = 0.09;
      } else if (state === "over" && performance.now() - overAt > 450) {
        reset(); state = "run"; sJump();
      }
    }
    function keysActive(e) {
      if (destroyed || !(hovered || focused)) return false;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return false;
      return true;
    }

    const onPointerDown = (e) => {
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      if (e.button === 2) { crouchHeld = true; return; }   // right click = crouch only
      crouchHeld = true;                                    // hold after the tap = crouch
      press();
    };
    const onPointerUp = () => { crouchHeld = false; };
    const onEnter = () => { hovered = true; };
    const onLeave = () => { hovered = false; };
    const onFocus = () => { focused = true; };
    const onBlurCanvas = () => { focused = false; };
    const onCtxMenu = (e) => e.preventDefault();
    const onKeyDown = (e) => {
      // THE PAGE grabs the keyboard globally (it owns the whole screen),
      // except while you're typing in a real form field
      if (pageMode || escaping) {
        const t = e.target;
        const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
        if (e.code === "Escape") { e.preventDefault(); returnToStrip(); return; }
        if (typing) return;
        if (e.code === "ArrowLeft" || e.code === "KeyA") { e.preventDefault(); pMoveL = true; return; }
        if (e.code === "ArrowRight" || e.code === "KeyD") { e.preventDefault(); pMoveR = true; return; }
        if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
          e.preventDefault(); if (!e.repeat) pJumpBuf = 0.12; return;
        }
        return;
      }
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
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jumpHeld = true;
        if (!e.repeat) press();
      }
      if (e.code === "ArrowDown" || e.code === "KeyS") { e.preventDefault(); crouchHeld = true; }
    };
    const onKeyUp = (e) => {
      if (pageMode || escaping) {
        if (e.code === "ArrowLeft" || e.code === "KeyA") pMoveL = false;
        if (e.code === "ArrowRight" || e.code === "KeyD") pMoveR = false;
        return;
      }
      if (e.code === "Space" || e.code === "ArrowUp") jumpHeld = false;
      if (e.code === "ArrowDown" || e.code === "KeyS") crouchHeld = false;
    };
    const onWinBlur = () => { crouchHeld = false; jumpHeld = false; pMoveL = false; pMoveR = false; };

    canvas.addEventListener("pointerdown", onPointerDown);
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

    // --- hits & pits ------------------------------------------------------------
    function die() {
      state = "over"; overAt = performance.now(); shakeT = 0.5;
      sDie();
      if (score > hiScore && !cheatedRun) {
        hiScore = score | 0;
        try { localStorage.setItem(storageKey, hiScore); } catch (e) {}
      }
    }
    function applyHit() {
      if (immortal) return;
      lead -= HIT_DAMAGE;
      iframesT = IFRAMES; lungeT = 0.5; shakeT = 0.3;
      if (lead <= 0) {
        lead = 0; dinoX = MOUTH_X;              // dragged into the jaws
        die();
      } else {
        sHit();
      }
    }
    function overPit() {
      const cx = dinoX + 7;
      for (const o of obstacles) {
        if (o.kind === "pit" && cx > o.x + 2 && cx < o.x + o.w - 2) return true;
      }
      return false;
    }

    // --- update ----------------------------------------------------------------
    function update(dt) {
      animT += dt;
      if (pageMode) { updatePage(dt); return; }        // THE PAGE owns the frame
      if (escaping) {                                   // bursting out of the strip
        escapeT += dt;
        pFade += (1 - pFade) * Math.min(1, dt * 5);
        if (escapeT > 0.7) { beginPageMode(); return; }
      }
      if (toastT > 0) toastT -= dt;
      if (shakeT > 0) shakeT -= dt;
      if (iframesT > 0) iframesT -= dt;
      if (lungeT > 0) lungeT -= dt;
      if (chompT > 0) chompT -= dt;
      if (warpT > 0) {
        warpT -= dt;
        warpStreak(); warpStreak(); warpStreak();
      }
      const speed = state === "run" ? speedFor(level) + Math.min(30, score * 0.015) : 30;

      scrollX += speed * dt;             // world-space odometer (cave rocks)
      for (const p of pebbles) {
        p.x -= speed * dt;
        if (p.x < -3) { p.x = W + Math.random() * 20; p.w = 1 + (Math.random() * 2 | 0); }
      }
      for (const s of sparks) {
        s.x -= speed * 0.22 * dt;
        if (s.x < -2) { s.x = W + 2; s.y = Math.random() * Math.max(6, groundY - 8); }
      }

      // particle fx keep animating even after death, so bursts finish fading
      for (const pt of particles) {
        pt.ttl -= dt;
        pt.vy += pt.g * dt;
        pt.x += (pt.vx - speed * pt.scroll) * dt;
        pt.y += pt.vy * dt;
        if ((pt.type === "rock" || pt.type === "chunk") && pt.y >= groundY) {
          pt.y = groundY; pt.vy = 0; pt.vx *= 0.5;
        }
      }
      particles = particles.filter((pt) => pt.ttl > 0 && pt.x > -10);

      if (state !== "run") return;

      if (immortal || turbo) cheatedRun = true;  // any cheated moment taints the run

      // lead regenerates while you run clean; dino eases toward its spot
      lead = Math.min(1, lead + LEAD_REGEN * dt);
      const targetX = MOUTH_X + (SAFE_X - MOUTH_X) * lead;
      dinoX += (targetX - dinoX) * Math.min(1, dt * 5);

      // score, level, and the warp between worlds — every level lasts
      // exactly LEVEL_TIME seconds; only the speed climbs
      score += speed * dt * 0.1;
      runT += dt;
      const newLevel = 1 + ((runT / LEVEL_TIME) | 0);
      if (newLevel !== level && !escaping) {
        level = newLevel;
        if (level === 6 && !escapeUsed) {               // clear THE DESERT -> break out
          escapeUsed = true;
          startEscape();
        } else {
        const nw = worldFor(level);
        if (nw.name !== world.name) {
          const prevSet = world.set, prevGroundC = world.pal.ground;
          world = nw;
          warpT = WARP_TIME;
          iframesT = Math.max(iframesT, WARP_TIME + 0.1);   // safe while adapting
          obstacles = [];
          toast = ""; toastT = 0;
          shakeT = 0.25;
          if (nw.set === "deep" && prevSet !== "deep") {    // dive cinematic
            introT = 0; introSplash = false; introC = prevGroundC;
            introEdgeX = W + 4; introPanY = 0;
          }
          sWarp();
        } else {
          toast = "LEVEL " + level; toastT = 1.4;
          shakeT = 0.2;
          sLevel();
        }
        }
      }

      // --- dino physics, per world mechanic --------------------------------
      const mech = world.mech;
      const yMin = -(groundY - DINO_H - 2);               // strip ceiling
      let crouching = false;

      if (mech === "run") {
        crouching = crouchHeld && onGround;
        if (crouching && !wasCrouch) sDuck();
        wasCrouch = crouching;
        if (!crouchHeld) crouchLatch = false;

        if (onGround && world.pits && overPit()) {        // the floor is gone
          onGround = false;
          dinoVY = Math.max(dinoVY, 30);
        }
        if (jumpBuffer > 0) {
          jumpBuffer -= dt;
          if (onGround) {
            dinoVY = JUMP_V; onGround = false; jumpBuffer = 0;
            // the press that started this jump must not also fast-fall it
            crouchLatch = crouchHeld;
            puffSmoke(dinoX + 5, groundY, 6);
            sJump();
          }
        }
        if (!onGround) {
          const fastFall = crouchHeld && !crouchLatch;    // fresh press mid-air
          dinoVY += GRAVITY * (fastFall ? FASTFALL : 1) * dt;
          dinoY += dinoVY * dt;
          if (dinoY >= 0) {
            if (world.pits && overPit()) {
              if (dinoY >= 9) {                           // sank into the lava
                if (iframesT <= 0) applyHit();
                lavaSplash(dinoX + 5, groundY + 2);
                dinoY = 0; dinoVY = 0; onGround = true;
              }
            } else {
              const impact = dinoVY;
              dinoY = 0; dinoVY = 0; onGround = true;
              kickRocks(dinoX + 5, groundY, impact > 230 ? 9 : 5, impact);
              if (impact > 230) puffSmoke(dinoX + 5, groundY, 4);
            }
          }
        }
      } else if (mech === "swim") {
        if (introT >= 0) {
          // cinematic beats: (A) the land scrolls out from under you,
          // (B) you drop off its edge while the "camera" pans down —
          // faked by sliding the old floor up; the canvas never moves
          introT += dt;
          const INTRO_DUR = 1.6, T_EDGE = 0.4;
          const t = Math.min(introT, INTRO_DUR);
          if (t < T_EDGE) {
            introEdgeX = (W + 4) - ((W + 4) - (dinoX + 10)) * (t / T_EDGE);
          } else {
            introEdgeX = dinoX + 10 - (t - T_EDGE) * speed;
          }
          const pRaw = t < T_EDGE ? 0 : (t - T_EDGE) / (INTRO_DUR - T_EDGE);
          const p = pRaw * pRaw * (3 - 2 * pRaw);         // ease in-out
          introPanY = p * (groundY + 8);
          const startTop = groundY - DINO_H;
          const midTop = ((H - DINO_H) / 2) | 0;
          const dip = Math.sin(p * Math.PI) * 5;          // falls, camera catches up
          dinoY = (startTop * (1 - p) + midTop * p + dip) - startTop;
          dinoVY = 0;
          onGround = t < T_EDGE;                          // running until the edge
          if (!introSplash && p > 0.45) {                 // hitting the water
            introSplash = true;
            for (let i = 0; i < 10; i++) {
              bubble(dinoX + Math.random() * 14, groundY - DINO_H + dinoY + Math.random() * 12);
            }
            sSwim();
          }
          if (introT > INTRO_DUR) introT = -1;
          jumpBuffer = 0;
          return;                                         // scripted — skip the rest
        }
        if (jumpBuffer > 0) {                             // tap = stroke upward
          jumpBuffer = 0;
          dinoVY = -78;
          crouchLatch = crouchHeld;                       // that press isn't a sink
          bubble(dinoX + 10, groundY - DINO_H + dinoY + 3);
          bubble(dinoX + 8, groundY - DINO_H + dinoY + 6);
          sSwim();
        }
        if (!crouchHeld) crouchLatch = false;
        const sink = crouchHeld && !crouchLatch;          // hold = dive fast
        dinoVY += (sink ? 500 : 170) * dt;
        dinoVY = Math.max(-90, Math.min(130, dinoVY));
        dinoY += dinoVY * dt;
        onGround = false;                       // open water: there is no floor
        const topY = groundY - DINO_H + dinoY;
        if (warpT > 0 || immortal) {
          // stay fully on screen while adapting to the water (or cheating)
          if (topY < 0) { dinoY -= topY; dinoVY = Math.max(dinoVY, 0); }
          if (topY > H - DINO_H) { dinoY -= topY - (H - DINO_H); dinoVY = Math.min(dinoVY, 0); }
        } else if (topY + DINO_H < -1 || topY > H + 1) {
          die();                                // swam completely off the screen
        }
        if (Math.random() < dt * 4) bubble(dinoX + 12, groundY - DINO_H + dinoY + 2);
      } else {                                            // fly: jetpack
        const thrust = crouchHeld || jumpHeld;
        jumpBuffer = 0;
        dinoVY += (thrust ? -560 : 520) * dt;
        dinoVY = Math.max(-140, Math.min(160, dinoVY));
        dinoY += dinoVY * dt;
        if (dinoY <= yMin) { dinoY = yMin; dinoVY = 0; }
        if (dinoY >= 0) {
          const impact = dinoVY;
          dinoY = 0; dinoVY = 0;
          if (!onGround && impact > 200) kickRocks(dinoX + 5, groundY, 5, impact);
          onGround = true;
        } else onGround = false;
        if (thrust) {
          flame(dinoX + 3 + Math.random() * 3, groundY - DINO_H + dinoY + 13);
          flame(dinoX + 5 + Math.random() * 3, groundY - DINO_H + dinoY + 13);
        }
      }

      // --- obstacles ----------------------------------------------------------
      nextSpawn -= speed * dt;
      if (nextSpawn <= 0 && warpT <= 0 && !escaping) {
        spawnObstacle(speed);
        const minGap = speed * 0.45 + 24;
        nextSpawn = minGap + Math.random() * (speed * 0.8 + 60);
      }
      for (const o of obstacles) {
        o.x -= (speed + (o.vx || 0)) * dt;
        if (o.kind === "jelly") o.y = o.baseY + Math.sin(animT * 2.2 + o.ph) * o.bob;
        if (o.kind === "missile" && o.x < W && Math.random() < dt * 40) {
          flame(o.x + o.w, o.y + 1);
        }
      }
      // everything you dodge gets devoured by the chaser
      obstacles = obstacles.filter((o) => {
        if (o.kind === "pit") return o.x > -34;           // pits just scroll away
        if (o.x + o.w <= 18) {
          munchBurst();
          chompT = 0.22;
          sChomp();
          return false;
        }
        return o.x > -24;
      });

      // collisions (AABB with 1px mercy inset) — hits knock you back,
      // only the chaser's jaws actually end the run
      if (iframesT <= 0) {
        let dx, dy, dw, dh;
        if (crouching) {
          dx = dinoX + 1;                dw = CROUCH_W - 3;
          dy = groundY - CROUCH_H + 1;   dh = CROUCH_H - 2;
        } else {
          dx = dinoX + 2;                         dw = DINO_W - 5;
          dy = groundY - DINO_H + dinoY + 1;      dh = DINO_H - 2;
        }
        for (const o of obstacles) {
          if (o.kind === "pit") continue;                 // pits are handled above
          if (dx < o.x + o.w - 1 && dx + dw > o.x + 1 && dy < o.y + o.h - 1 && dy + dh > o.y + 1) {
            applyHit();
            break;
          }
        }
      }
    }

    // --- the chaser: a huge dino head, drawn procedurally so it fills
    // whatever strip height we get. Jaws chomp, lunges when it tastes you.
    let eyeX = 0, eyeY = 0;                     // remembered for the dark worlds
    function drawChaser() {
      const ch = world.chase;
      const top = 2, bot = groundY + 2, hH = bot - top;
      const x0 = -7 + (lungeT > 0 ? (lungeT * 16) | 0 : 0);
      const headW = 24;
      const upperH = Math.max(6, (hH * 0.42) | 0);
      const jawY = top + upperH;                                  // upper jaw underside
      let gap = hH * 0.22 + Math.sin(animT * 2.5) * hH * 0.10;    // ambient chomping
      if (lungeT > 0) gap = hH * 0.45;                            // roar: wide open
      if (chompT > 0) gap = 3;                                    // crunch! obstacle eaten
      if (state === "over") gap = 2;                              // chomped shut
      gap = Math.max(2, gap | 0);
      const lowY = Math.min(bot - 3, jawY + gap);

      ctx.save();
      ctx.shadowColor = ch.body;
      ctx.shadowBlur = GLOW;
      ctx.fillStyle = ch.body;
      for (let y = top; y < jawY; y++) {                          // skull + upper jaw
        const k = (y - top) / upperH;
        ctx.fillRect(x0, y, (headW * (0.45 + 0.55 * Math.min(1, k * 1.4))) | 0, 1);
      }
      for (let y = lowY; y < bot; y++) {                          // lower jaw
        const k = (y - lowY) / Math.max(1, bot - lowY);
        ctx.fillRect(x0, y, ((headW - 6) * (1 - 0.35 * k)) | 0, 1);
      }
      ctx.shadowColor = ch.teeth;
      ctx.fillStyle = ch.teeth;
      for (let tx = x0 + 5; tx < x0 + headW - 2; tx += 4) {
        ctx.fillRect(tx, jawY, 2, 1);                             // upper teeth (down)
        ctx.fillRect(tx, jawY + 1, 1, 1);
        if (tx < x0 + headW - 8) {
          ctx.fillRect(tx + 1, lowY - 1, 2, 1);                   // lower teeth (up)
          ctx.fillRect(tx + 2, lowY - 2, 1, 1);
        }
      }
      ctx.shadowColor = ch.eye;
      ctx.fillStyle = ch.eye;
      eyeX = x0 + 6;
      eyeY = top + Math.max(2, (upperH * 0.35) | 0);
      ctx.fillRect(eyeX, eyeY, 2, 1);
      if (ch.lure) {                                              // anglerfish light
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(animT * 7);
        ctx.fillRect(x0 + 15, top, 2, 2);
      }
      ctx.restore();
    }

    // --- render -----------------------------------------------------------------
    function render() {
      if (pageMode) { renderPageFrame(); return; }      // THE PAGE takes the screen
      const p = pal();
      ctx.clearRect(0, 0, W, H);           // transparent background
      ctx.save();
      if (shakeT > 0) {
        ctx.translate((Math.random() * 3 - 1) | 0, (Math.random() * 3 - 1) | 0);
      }

      // drifting sparks (bubbles-ish in the deep, embers in the molten path)
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = p.fg;
      for (const s of sparks) ctx.fillRect(s.x | 0, s.y | 0, 1, 1);
      ctx.restore();

      // ground — with molten gaps where pits are (the deep has no floor
      // at all: it's open water from screen top to screen bottom)
      if (world.set !== "deep") {
      ctx.save();
      ctx.fillStyle = p.ground;
      ctx.shadowColor = p.ground;
      ctx.shadowBlur = GLOW;
      const pits = world.pits ? obstacles.filter((o) => o.kind === "pit").sort((a, b) => a.x - b.x) : [];
      let gx = 0;
      for (const o of pits) {
        const a = Math.max(0, o.x | 0), b = Math.min(W, (o.x + o.w) | 0);
        if (a > gx) ctx.fillRect(gx, groundY, a - gx, 1);
        ctx.fillStyle = "#ff6a00";
        ctx.shadowColor = "#ff6a00";
        for (let lx = a; lx < b; lx += 2) {                 // bubbling lava
          const jitter = (lx * 7 + ((animT * 6) | 0) * 3) % 4;
          ctx.fillStyle = jitter === 0 ? "#ffe94d" : "#ff6a00";
          ctx.fillRect(lx, groundY + 1 + (jitter % 2), 1, 1);
        }
        ctx.fillStyle = p.ground;
        ctx.shadowColor = p.ground;
        gx = Math.max(gx, b);
      }
      if (gx < W) ctx.fillRect(gx, groundY, W - gx, 1);
      if (world.set === "cavern") {
        // rocky roof (purely decorative — it never kills) and rubble
        // packed under the floor, scrolling with the world
        const rnd01 = (i) => {
          const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
          return s - Math.floor(s);
        };
        for (let j = ((scrollX / 4) | 0) - 1; j * 4 - scrollX < W + 4; j++) {
          const sx = (j * 4 - scrollX) | 0;
          const r = rnd01(j);
          const roofH = 1 + ((r * 3) | 0) + (r > 0.93 ? 3 : 0);   // odd fang
          ctx.fillRect(sx, 0, 4, roofH);
          const r2 = rnd01(j * 7.13 + 3.7);
          ctx.fillRect(sx, groundY + 1, 4, 1 + ((r2 * 2) | 0));   // rubble
          if (r2 > 0.82) ctx.fillRect(sx + 1, groundY - 1, 2, 1); // tiny nub
        }
      }
      ctx.globalAlpha = 0.7;
      for (const pb of pebbles) ctx.fillRect(pb.x | 0, pb.y | 0, pb.w, 1);
      ctx.restore();
      }

      // dive cinematic: what's left of the old land, sliding up and away
      // (the fake camera pan — the canvas itself never moves)
      if (world.set === "deep" && introT >= 0) {
        const fy = (groundY - introPanY) | 0;
        const fe = Math.min(W, introEdgeX | 0);
        if (fy > -2 && fe > 0) {
          ctx.save();
          ctx.fillStyle = introC;
          ctx.shadowColor = introC;
          ctx.shadowBlur = GLOW;
          ctx.fillRect(0, fy, fe, 1);
          ctx.fillRect(fe - 1, fy, 1, 2);                 // the cliff lip
          ctx.restore();
        }
      }

      // obstacles
      for (const o of obstacles) {
        if (o.kind === "bird") {
          drawSprite((animT * 6 | 0) % 2 ? BIRD_A : BIRD_B, o.x, o.y, p.ac);
        } else if (o.kind === "jelly") {
          drawSprite((animT * 4 | 0) % 2 ? JELLY_A : JELLY_B, o.x, o.y, p.ob);
        } else if (o.kind === "mine") {
          drawSprite(MINE, o.x, o.y, p.ac);
        } else if (o.kind === "missile") {
          if (o.x >= W) {                                  // incoming warning
            if ((animT * 8 | 0) % 2) drawText("!", W - 6, Math.max(2, o.y | 0), p.ac);
          } else {
            drawSprite(MISSILE, o.x, o.y, p.ac);
          }
        } else if (o.kind === "laser") {
          ctx.save();
          ctx.globalAlpha = 0.45 + 0.45 * Math.abs(Math.sin(animT * 8 + o.x));
          ctx.fillStyle = p.ob;
          ctx.shadowColor = p.ob;
          ctx.shadowBlur = GLOW;
          ctx.fillRect(o.x | 0, o.y | 0, o.w, o.h | 0);
          ctx.restore();
        } else if (o.kind === "stal") {
          ctx.save();
          ctx.fillStyle = p.ob;
          ctx.shadowColor = p.ob;
          ctx.shadowBlur = GLOW;
          for (let yy = 0; yy < o.h; yy++) {               // tapering spike
            const wdt = Math.max(1, o.w - (((yy / o.h) * (o.w - 1)) | 0));
            ctx.fillRect((o.x + (((o.w - wdt) / 2) | 0)) | 0, yy, wdt, 1);
          }
          ctx.restore();
        } else if (o.kind === "cactus") {
          drawSprite(o.rows, o.x, o.y, p.ob);
        }
        // pits render inside the ground pass
      }

      // dino (blinks while invulnerable after a hit)
      const mech = world.mech;
      const crouching = mech === "run" && crouchHeld && onGround && state === "run";
      const blinkHidden = iframesT > 0 && warpT <= 0 && (animT * 12 | 0) % 2 === 0;
      if (!blinkHidden) {
        if (crouching) {
          const frame = (animT * 10 | 0) % 2 ? DINO_CROUCH_A : DINO_CROUCH_B;
          drawSprite(frame, dinoX, groundY - CROUCH_H, p.fg);
        } else {
          let frame = DINO_JUMP;
          if (state === "idle") frame = DINO_RUN_A;
          else if (mech === "swim") frame = (animT * 6 | 0) % 2 ? DINO_RUN_A : DINO_RUN_B;
          else if (mech === "run" && state === "run" && onGround) {
            frame = (animT * 10 | 0) % 2 ? DINO_RUN_A : DINO_RUN_B;
          } else if (mech === "fly" && onGround && state === "run") {
            frame = (animT * 10 | 0) % 2 ? DINO_RUN_A : DINO_RUN_B;
          }
          drawSprite(frame, dinoX, groundY - DINO_H + dinoY, p.fg);
          if (state === "over") {  // X eye
            ctx.clearRect(dinoX + 9, groundY - DINO_H + dinoY + 1, 2, 2);
            ctx.fillStyle = p.fg;
            ctx.fillRect(dinoX + 9, groundY - DINO_H + dinoY + 1, 1, 1);
            ctx.fillRect(dinoX + 10, groundY - DINO_H + dinoY + 2, 1, 1);
          }
        }
      }

      // particle fx
      ctx.save();
      for (const pt of particles) {
        const fade = Math.max(0, pt.ttl / pt.life);
        ctx.globalAlpha =
          pt.type === "smoke" ? fade * 0.55 :
          pt.type === "bubble" ? fade * 0.6 :
          pt.type === "streak" ? fade * 0.8 : fade;
        ctx.fillStyle = pt.col || (pt.type === "smoke" ? p.fg : p.ground);
        if (pt.type === "streak") ctx.fillRect(pt.x | 0, pt.y | 0, 7, 1);
        else ctx.fillRect(pt.x | 0, pt.y | 0, pt.size, pt.size);
      }
      ctx.restore();

      // the chaser is drawn over the dino, so falling to lead 0 reads
      // as being swallowed by the jaws
      drawChaser();

      // darkness: keep only a spotlight around the dino (the page behind
      // the canvas is untouched — we mask our own pixels, not the host)
      if (world.dark) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-in";
        const cxd = dinoX + 7, cyd = groundY - DINO_H + dinoY + 7;
        // sight reaches past the middle of the strip: obstacles emerge
        // from the dark around half-screen, leaving real reaction time
        const R = Math.max(90, W * 0.52);
        const grad = ctx.createRadialGradient(cxd, cyd, R * 0.55, cxd, cyd, R);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(-4, -4, W + 8, H + 8);
        ctx.restore();
        // ...but the chaser's eye still glints in the dark
        ctx.save();
        ctx.fillStyle = world.chase.eye;
        ctx.shadowColor = world.chase.eye;
        ctx.shadowBlur = GLOW;
        ctx.fillRect(eyeX, eyeY, 2, 1);
        ctx.restore();
      }

      // HUD (drawn after the mask so it's always readable)
      const sc = String(score | 0).padStart(5, "0");
      drawText(sc, W - textW(sc) - 3, 3, p.fg);
      if (hiScore > 0 && W > 220) {
        const hs = "HI " + String(hiScore).padStart(5, "0");
        drawText(hs, W - textW(sc) - textW(hs) - 10, 3, p.ground);
      }
      drawText("LV " + level, 28, 3, p.fg);

      // active cheats are announced permanently, top center, for the
      // whole run — no stealth cheating on real runs
      if (immortal || turbo) {
        const badge = [immortal ? "IMMORTAL" : "", turbo ? "TURBO" : ""]
          .filter(Boolean).join("  ");
        drawText(badge, ((W / 2) | 0) - ((textW(badge) / 2) | 0), 3, p.ac);
      }

      // warp tease: the last level of every world knows something is coming
      // (the top-center spot belongs to the cheat badge when one is on)
      if (!immortal && !turbo && state === "run" && warpT <= 0 && toastT <= 0 && level % 5 === 0 &&
          W > 200 && (animT * 2 | 0) % 2) {
        const m = "WARP AHEAD";
        drawText(m, ((W / 2) | 0) - ((textW(m) / 2) | 0), 3, p.ac);
      }

      // center messages
      const cx = (W / 2) | 0;
      const cy = Math.max(3, ((H / 2) | 0) - 6);
      if (warpT > 0) {
        const m = "ENTERING " + world.name;
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(animT * 6);
        drawText(m, cx - (textW(m) / 2 | 0), cy, p.ac);
        ctx.restore();
      } else if (state === "idle") {
        const m = (animT / 1.8 | 0) % 2 ? "TAP JUMP   HOLD CROUCH" : "CLICK TO START";
        if ((animT * 2 | 0) % 3) drawText(m, cx - (textW(m) / 2 | 0), cy, p.fg);
      } else if (state === "over") {
        const m1 = "GAME OVER";
        drawText(m1, cx - (textW(m1) / 2 | 0), cy, p.ac);
        if ((animT * 2 | 0) % 2) {
          const m2 = "CLICK TO RETRY";
          drawText(m2, cx - (textW(m2) / 2 | 0), Math.min(groundY - 6, cy + 7), p.ground);
        }
      } else if (toastT > 0 && (animT * 4 | 0) % 2) {
        drawText(toast, cx - (textW(toast) / 2 | 0), cy, p.ac);
      }

      ctx.restore();

      if (escaping) renderPageFrame();     // the overlay fades in over the strip
    }

    // ===================================================================
    // THE PAGE — the level-6 break-out onto the real DOM
    // ===================================================================

    // scaled pixel-sprite / pixel-font drawers for the big overlay canvas
    function pSprite(rows, x, y, color, px, flip) {
      pctx.save();
      pctx.fillStyle = color;
      pctx.shadowColor = color;
      pctx.shadowBlur = GLOW * px;
      const w = rows[0] ? rows[0].length : 0;
      const s = Math.ceil(px);
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          if (row[c] === "#") {
            const cc = flip ? (w - 1 - c) : c;
            pctx.fillRect((x + cc * px) | 0, (y + r * px) | 0, s, s);
          }
        }
      }
      pctx.restore();
    }
    function pTextW(str, px) { return str.length * 4 * px - px; }
    function pText(str, x, y, color, px) {
      pctx.save();
      pctx.fillStyle = color;
      pctx.shadowColor = color;
      pctx.shadowBlur = GLOW * px * 0.6;
      const s = Math.ceil(px);
      for (let i = 0; i < str.length; i++) {
        const g = FONT[str[i]] || FONT[" "];
        for (let b = 0; b < 15; b++) {
          if (g[b] === "1")
            pctx.fillRect((x + (i * 4 + (b % 3)) * px) | 0, (y + (b / 3 | 0) * px) | 0, s, s);
        }
      }
      pctx.restore();
    }

    function pageResize() {
      if (!pageCanvas) return;
      pdpr = Math.min(2, global.devicePixelRatio || 1);
      pvw = Math.max(1, global.innerWidth);
      pvh = Math.max(1, global.innerHeight);
      pageCanvas.width = (pvw * pdpr) | 0;
      pageCanvas.height = (pvh * pdpr) | 0;
      // keep the runner EXACTLY its strip size: one logical pixel here is the
      // same CSS size it is inside the strip (container height / strip rows)
      const cr = container.getBoundingClientRect();
      PX = Math.max(1, Math.round(cr.height / Math.max(1, H)));
      pctx.setTransform(pdpr, 0, 0, pdpr, 0, 0);
      pctx.imageSmoothingEnabled = false;
    }

    // snapshot the TOP EDGE of every visible DOM box as a one-way ledge —
    // text lines, media, and any filled or bordered box (cards, panels,
    // sections). You land on the top; you never catch on a bottom edge.
    function borderVisible(wd, st, col) {
      return parseFloat(wd) > 0.5 && st !== "none" && st !== "hidden" &&
             col !== "rgba(0, 0, 0, 0)" && col !== "transparent";
    }
    function scanPlatforms() {
      if (!pageCanvas) return;
      const out = [];
      const add = (x, w, y) => { if (w >= 20 && y > 2 && y < pvh - 1) out.push({ x: x, y: y, w: w }); };
      const nodes = document.body.querySelectorAll(
        "h1,h2,h3,h4,h5,h6,p,li,button,a,img,pre,code,td,th,tr,input,label,figure," +
        "blockquote,summary,div,section,header,footer,article,aside,nav,table,ul,ol");
      for (let i = 0; i < nodes.length && out.length < 600; i++) {
        const el = nodes[i];
        if (el === pageCanvas || el === container) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity < 0.06) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 24 || r.height > pvh * 0.92) continue;   // skip near-fullscreen wrappers
        if (r.bottom < 4 || r.top > pvh - 2 || r.right < 2 || r.left > pvw - 2) continue;
        const x = Math.max(0, r.left);
        const w = Math.min(pvw, r.right) - x;

        const tag = el.tagName;
        const media = tag === "IMG" || tag === "BUTTON" || tag === "INPUT" || tag === "A";
        let ownText = false;                 // has its OWN text (a real printed line)
        for (let n = el.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3 && n.nodeValue.trim()) { ownText = true; break; }
        }
        const bg = cs.backgroundColor;
        const filled = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
        const bTop = borderVisible(cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor);

        if (media || ownText || filled || bTop) add(x, w, Math.round(r.top));   // top edge only
      }
      // the strip's OWN floor line, aligned to where it sits on screen — this
      // is the launch ledge, so breaking out feels seamless with the old ground
      const cr = container.getBoundingClientRect();
      if (cr.width > 4 && cr.bottom > 2 && cr.top < pvh - 1) {
        const gy = Math.round(cr.top + groundY * (cr.height / Math.max(1, H)));
        add(Math.max(0, cr.left), Math.min(pvw, cr.right) - Math.max(0, cr.left), gy);
      }
      out.push({ x: 0, y: pvh - 3, w: pvw, floor: true });   // the viewport floor
      plats = out;
    }

    const pOnPointer = (e) => {
      if (!pageMode) return;
      e.preventDefault();
      pJumpBuf = 0.12;                                      // click / tap = jump
      const cx = ppx + DINO_W * PX * 0.36;                 // and steer toward the tap
      if (e.clientX < cx) { pMoveL = true; pMoveR = false; }
      else { pMoveR = true; pMoveL = false; }
    };
    const pOnPointerUp = () => { if (pageMode) { pMoveL = false; pMoveR = false; } };

    function mountOverlay() {
      if (pageCanvas) return;
      pageCanvas = document.createElement("canvas");
      Object.assign(pageCanvas.style, {
        position: "fixed", left: "0", top: "0",
        width: "100vw", height: "100vh",
        margin: "0", padding: "0", border: "0",
        zIndex: "2147483600", display: "block",
        pointerEvents: "auto", cursor: "crosshair",
        background: "transparent", touchAction: "none",
      });
      (document.body || document.documentElement).appendChild(pageCanvas);
      pctx = pageCanvas.getContext("2d", { alpha: true });
      pageResize();
      scanPlatforms();
      pFade = 0; pFadeTarget = 1;
      pOnResize = () => { pageResize(); scanPlatforms(); };
      pOnScroll = () => scanPlatforms();
      global.addEventListener("resize", pOnResize);
      global.addEventListener("scroll", pOnScroll, true);
      pageCanvas.addEventListener("pointerdown", pOnPointer);
      pageCanvas.addEventListener("pointerup", pOnPointerUp);
      pageCanvas.addEventListener("pointercancel", pOnPointerUp);
      if (io) io.disconnect();               // the strip's auto-pause must not freeze us
    }

    function unmountOverlay() {
      if (!pageCanvas) return;
      global.removeEventListener("resize", pOnResize);
      global.removeEventListener("scroll", pOnScroll, true);
      pageCanvas.removeEventListener("pointerdown", pOnPointer);
      pageCanvas.removeEventListener("pointerup", pOnPointerUp);
      pageCanvas.removeEventListener("pointercancel", pOnPointerUp);
      pageCanvas.remove();
      pageCanvas = null; pctx = null;
      plats = []; pEnemies = []; pParticles = [];
    }

    function startEscape() {
      escaping = true; escapeT = 0;
      warpT = 0; obstacles = [];
      iframesT = 999;                        // untouchable while bursting out
      onGround = false; dinoVY = JUMP_V * 1.7;   // launch up out of the strip
      toast = "ESCAPE!"; toastT = 1.6;
      sWarp();
      mountOverlay();
    }

    function beginPageMode() {
      escaping = false; pageMode = true;
      const r = container.getBoundingClientRect();
      const sx = r.width / Math.max(1, W), sy = r.height / Math.max(1, H);
      PX = Math.max(1, Math.round(sy));              // same size the runner had in the strip
      scanPlatforms();
      const floorY = r.top + groundY * sy;           // the old strip floor, on screen
      ppx = r.left + SAFE_X * sx;                    // where the runner was standing
      ppy = floorY - DINO_H * PX;                    // stand exactly on that floor
      pvx = 0; pvy = 0; pPrevFeet = ppy + DINO_H * PX;
      pOnGround = true; pMoveL = pMoveR = false; pFacing = 1;
      pLead = 1; pIfr = 1.0; pDying = false; pDieT = 0;
      pEnemies = []; pParticles = []; pSpawnT = 0.9; platScanT = 0.5;
      toast = ""; toastT = 0;
      ctx.clearRect(0, 0, W, H);                     // wipe the frozen strip behind the overlay
    }

    function returnToStrip() {
      const wasCheated = cheatedRun;
      unmountOverlay();
      pageMode = false; escaping = false;
      pMoveL = pMoveR = false;
      if (score > hiScore && !wasCheated) {
        hiScore = score | 0;
        try { localStorage.setItem(storageKey, hiScore); } catch (e) {}
      }
      dinoY = 0; dinoVY = 0; onGround = true; dinoX = MOUTH_X;   // tidy the strip behind GAME OVER
      state = "over"; overAt = performance.now(); shakeT = 0.4; iframesT = 0;
      toast = "THE PAGE ATE YOU"; toastT = 2.4;
      if (io) io.observe(container);         // hand auto-pause back to the strip
    }

    function spawnPageEnemy() {
      const kinds = ["bird", "mine", "missile"];
      const kind = kinds[(Math.random() * kinds.length) | 0];
      const side = (Math.random() * 4) | 0;
      let x, y;
      if (side === 0) { x = -20; y = Math.random() * pvh; }
      else if (side === 1) { x = pvw + 20; y = Math.random() * pvh; }
      else if (side === 2) { x = Math.random() * pvw; y = -20; }
      else { x = Math.random() * pvw; y = pvh + 20; }
      const base = 90 + Math.min(230, score * 0.35);
      pEnemies.push({
        kind: kind, x: x, y: y, vx: 0, vy: 0, t: 0,
        w: (kind === "mine" ? 7 : 10) * PX * 0.7,
        h: (kind === "mine" ? 5 : kind === "missile" ? 3 : 6) * PX * 0.7,
        spd: base * (kind === "missile" ? 1.35 : kind === "mine" ? 0.8 : 1),
        turn: kind === "missile" ? 1.4 : kind === "mine" ? 0.55 : 2.2,
      });
    }
    function applyPageHit(e) {
      pLead -= 0.34; pIfr = 1.1; shakeT = 0.3;
      e.t = 20;                              // fling the offender off so it can't chain
      if (pLead <= 0) { pLead = 0; pDying = true; pDieT = 0; shakeT = 0.6; sDie(); }
      else sHit();
    }

    // jump/land fx, ported from the strip's puffSmoke/kickRocks but in CSS px
    // and scaled by PX so they stay proportional to the (strip-sized) runner
    function pAddSmoke(x, y, n) {
      for (let i = 0; i < n; i++) {
        const life = 0.4 + Math.random() * 0.3;
        pParticles.push({
          type: "smoke",
          x: x + (Math.random() * 8 - 3) * PX * 0.4, y: y - Math.random() * 3 * PX,
          vx: (-4 - Math.random() * 10) * PX, vy: (-6 - Math.random() * 10) * PX, g: -12 * PX,
          size: (Math.random() < 0.4 ? 2 : 1) * PX, life: life, ttl: life,
        });
      }
    }
    function pAddRocks(x, y, n, gy) {
      for (let i = 0; i < n; i++) {
        const life = 0.45 + Math.random() * 0.3;
        pParticles.push({
          type: "rock",
          x: x + (Math.random() * 10 - 3) * PX * 0.4, y: y - PX,
          vx: (Math.random() * 2 - 1) * 34 * PX, vy: -(24 + Math.random() * 34) * PX,
          g: 420 * PX, gy: gy, size: (Math.random() < 0.25 ? 2 : 1) * PX, life: life, ttl: life,
        });
      }
    }
    // the single ledge to light up: the one under the runner's feet (standing
    // on it, or dropping onto it) — never the whole page of edges at once
    function pCurrentLedge() {
      const dw = DINO_W * PX * 0.72, feet = ppy + DINO_H * PX;
      let best = null, bestY = Infinity;
      for (const pl of plats) {
        if (ppx + dw > pl.x + 2 && ppx < pl.x + pl.w - 2 && pl.y >= feet - 3 && pl.y < bestY) {
          best = pl; bestY = pl.y;
        }
      }
      return best;
    }

    function updatePage(dt) {
      if (dt > 0.05) dt = 0.05;              // keep physics sane if turbo/lag inflates dt
      pFade += (pFadeTarget - pFade) * Math.min(1, dt * 6);
      if (toastT > 0) toastT -= dt;
      if (shakeT > 0) shakeT -= dt;
      if (pIfr > 0) pIfr -= dt;

      if (pDying) {                          // the jaws close, fade out, hand back
        pDieT += dt;
        if (pDieT > 0.7) pFadeTarget = 0;
        if (pDieT > 1.5 && pFade < 0.04) returnToStrip();
        return;
      }

      platScanT -= dt;
      if (platScanT <= 0) { scanPlatforms(); platScanT = 0.5; }   // DOM may reflow
      if (immortal || turbo) cheatedRun = true;
      score += dt * 14;

      const dw = DINO_W * PX * 0.72, dh = DINO_H * PX;

      // --- horizontal movement (arrows / A-D / tap side) ---
      const ACC = 3200, FRIC = 2800, MOVE = 360;
      const want = (pMoveR ? 1 : 0) - (pMoveL ? 1 : 0);
      if (want !== 0) {
        pvx += want * ACC * dt; pFacing = want;
        if (pvx > MOVE) pvx = MOVE;
        if (pvx < -MOVE) pvx = -MOVE;
      } else if (pvx !== 0) {
        const s = pvx > 0 ? 1 : -1;
        pvx -= s * FRIC * dt;
        if ((pvx > 0 ? 1 : -1) !== s) pvx = 0;
      }
      ppx += pvx * dt;
      if (ppx < 0) { ppx = 0; pvx = 0; }
      if (ppx > pvw - dw) { ppx = pvw - dw; pvx = 0; }

      // --- gravity + one-way platform landing ---
      const G = 2600, MAXFALL = 1500, JUMP = -900;
      const prevGround = pOnGround;
      pvy += G * dt; if (pvy > MAXFALL) pvy = MAXFALL;
      const impV = pvy;                      // fall speed at the moment of impact
      const feet0 = pPrevFeet;
      ppy += pvy * dt;
      const feet = ppy + dh;
      pOnGround = false;
      let landedY = 0;
      if (pvy >= 0) {
        for (const pl of plats) {
          if (ppx + dw > pl.x + 2 && ppx < pl.x + pl.w - 2 &&
              feet0 <= pl.y + 4 && feet >= pl.y) {
            ppy = pl.y - dh; pvy = 0; pOnGround = true; pCoyote = 0.1; landedY = pl.y; break;
          }
        }
      }
      if (ppy > pvh + 60) { ppy = pvh - dh - 3; pvy = 0; pOnGround = true; landedY = pvh - 3; }
      if (pOnGround && !prevGround) {         // just touched down — kick up rocks (+ dust if hard)
        const fx = ppx + dw * 0.5;
        pAddRocks(fx, landedY, impV > 480 ? 9 : 5, landedY);
        if (impV > 480) pAddSmoke(fx, landedY, 4);
      }
      pPrevFeet = ppy + dh;
      if (pCoyote > 0) pCoyote -= dt;
      if (pJumpBuf > 0) pJumpBuf -= dt;
      if (pJumpBuf > 0 && (pOnGround || pCoyote > 0)) {
        pvy = JUMP; pOnGround = false; pCoyote = 0; pJumpBuf = 0;
        pAddSmoke(ppx + dw * 0.5, ppy + dh, 6);   // puff off the launch
        sJump();
      }

      // --- enemies: spawn from the edges, home in on the runner ---
      pSpawnT -= dt;
      const maxE = 4 + Math.min(6, (score / 400) | 0);
      if (pSpawnT <= 0 && pEnemies.length < maxE) {
        spawnPageEnemy();
        pSpawnT = Math.max(0.45, 1.5 - score * 0.0006);
      }
      const cx = ppx + dw / 2, cy = ppy + dh / 2;
      for (const e of pEnemies) {
        e.t += dt;
        const dx = cx - e.x, dy = cy - e.y;
        const d = Math.hypot(dx, dy) || 1;
        e.vx += ((dx / d) * e.spd - e.vx) * Math.min(1, dt * e.turn);
        e.vy += ((dy / d) * e.spd - e.vy) * Math.min(1, dt * e.turn);
        e.x += e.vx * dt; e.y += e.vy * dt;
        if (pIfr <= 0 && !immortal &&
            e.x + e.w > ppx + 4 && e.x < ppx + dw - 4 &&
            e.y + e.h > ppy + 4 && e.y < ppy + dh - 4) {
          applyPageHit(e);
        }
      }
      pEnemies = pEnemies.filter((e) => e.t < 14);

      // dust & rocks physics (rocks settle onto the ledge they were kicked from)
      for (const pt of pParticles) {
        pt.ttl -= dt; pt.vy += pt.g * dt;
        pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        if (pt.type === "rock" && pt.gy != null && pt.y >= pt.gy) { pt.y = pt.gy; pt.vy = 0; pt.vx *= 0.5; }
      }
      pParticles = pParticles.filter((pt) => pt.ttl > 0);
    }

    // the chaser's jaws swinging shut over the runner on death
    function drawPageChomp() {
      const ch = world.chase, p = pal();
      const t = Math.min(1, pDieT / 0.7);
      const cx = ppx + DINO_W * PX * 0.4, cy = ppy + DINO_H * PX * 0.5;
      const reach = Math.max(pvw, pvh);
      const open = (1 - t) * reach * 0.55 + PX * 3;      // closes as t -> 1
      pctx.save();
      pctx.globalAlpha = pFade;
      pctx.fillStyle = ch.body; pctx.shadowColor = ch.body; pctx.shadowBlur = GLOW * PX;
      pctx.beginPath();                                   // upper jaw
      pctx.moveTo(cx - reach, cy - open - reach);
      pctx.lineTo(cx + PX * 8, cy - open);
      pctx.lineTo(cx - reach, cy - open + PX * 5);
      pctx.closePath(); pctx.fill();
      pctx.beginPath();                                   // lower jaw
      pctx.moveTo(cx - reach, cy + open + reach);
      pctx.lineTo(cx + PX * 8, cy + open);
      pctx.lineTo(cx - reach, cy + open - PX * 5);
      pctx.closePath(); pctx.fill();
      pctx.fillStyle = ch.teeth; pctx.shadowColor = ch.teeth;   // teeth
      for (let tx = cx - reach + PX * 6; tx < cx + PX * 6; tx += PX * 3) {
        pctx.fillRect(tx, cy - open, PX * 1.4, PX * 2);
        pctx.fillRect(tx, cy + open - PX * 2, PX * 1.4, PX * 2);
      }
      pctx.restore();
      if (t < 0.9) pSprite(DINO_JUMP, ppx, ppy, p.fg, PX, pFacing < 0);
    }

    function pHealthBar(p) {
      const w = 14 * PX, h = 3 * PX, x0 = pvw - w - 10, y0 = 10;
      pctx.save();
      pctx.globalAlpha = 0.9 * pFade;
      pctx.strokeStyle = p.fg; pctx.lineWidth = Math.max(1, PX / 2);
      pctx.shadowColor = p.fg; pctx.shadowBlur = GLOW * PX;
      pctx.strokeRect(x0, y0, w, h);
      pctx.fillStyle = pLead > 0.34 ? p.fg : p.ac;
      pctx.shadowColor = pctx.fillStyle;
      pctx.fillRect(x0 + 2, y0 + 2, Math.max(0, (w - 4) * pLead) | 0, h - 4);
      pctx.restore();
    }

    // renders the whole overlay (used both while bursting out and in page mode)
    function renderPageFrame() {
      if (!pctx) return;
      const p = pal();
      pctx.setTransform(pdpr, 0, 0, pdpr, 0, 0);
      pctx.clearRect(0, 0, pvw, pvh);
      pctx.save();
      if (shakeT > 0) pctx.translate((Math.random() * 5 - 2) | 0, (Math.random() * 5 - 2) | 0);

      // dim the page so the neon pops (the real page still shows through)
      pctx.save();
      pctx.globalAlpha = 0.45 * pFade;
      pctx.fillStyle = "#04010f";
      pctx.fillRect(-4, -4, pvw + 8, pvh + 8);
      pctx.restore();

      // ONLY the ledge under the runner lights up — the one it's standing on,
      // or the one it's dropping toward mid-jump — not the whole page of edges
      if (pageMode && !pDying) {
        const ledge = pCurrentLedge();
        if (ledge) {
          pctx.save();
          pctx.globalAlpha = 0.9 * pFade;
          pctx.fillStyle = p.ground; pctx.shadowColor = p.ground; pctx.shadowBlur = GLOW * PX * 2;
          pctx.fillRect(ledge.x | 0, ledge.y | 0, ledge.w | 0, ledge.floor ? 3 : 2);
          pctx.restore();
        }
      }

      if (pageMode && !pDying) {
        for (const e of pEnemies) {
          const rows = e.kind === "mine" ? MINE
                     : e.kind === "missile" ? MISSILE
                     : ((animT * 8 | 0) % 2 ? BIRD_A : BIRD_B);
          pSprite(rows, e.x, e.y, p.ac, PX * 0.7, e.vx > 0);
        }
        const blink = pIfr > 0 && (animT * 12 | 0) % 2 === 0;
        if (!blink) {
          const moving = Math.abs(pvx) > 20;
          const frame = pOnGround
            ? (moving ? ((animT * 12 | 0) % 2 ? DINO_RUN_A : DINO_RUN_B) : DINO_RUN_A)
            : DINO_JUMP;
          pSprite(frame, ppx, ppy, p.fg, PX, pFacing < 0);
        }
        // jump/land dust and rocks — same fx language as the strip
        for (const pt of pParticles) {
          const fade = Math.max(0, pt.ttl / pt.life);
          pctx.globalAlpha = (pt.type === "smoke" ? 0.55 : 1) * fade * pFade;
          pctx.fillStyle = pt.type === "smoke" ? p.fg : p.ground;
          pctx.fillRect(pt.x | 0, pt.y | 0, Math.ceil(pt.size), Math.ceil(pt.size));
        }
        pctx.globalAlpha = 1;
      }
      if (pDying) drawPageChomp();

      // HUD
      const sc = String(score | 0).padStart(5, "0");
      pText("SCORE " + sc, 10, 10, p.fg, Math.max(2, (PX / 2) | 0));
      pHealthBar(p);
      if (pageMode && !pDying) {
        const hint = "ARROWS MOVE   SPACE JUMP   ESC OUT";
        pText(hint, 10, (pvh - 14 * (PX / 2.4)) | 0, p.ground, Math.max(2, (PX / 2.4) | 0));
      }
      if (escaping || (!pageMode && pFade > 0.05)) {
        const s2 = Math.max(3, PX | 0);
        const m = "ESCAPING";
        pText(m, ((pvw - pTextW(m, s2)) / 2) | 0, ((pvh - 5 * s2) / 2) | 0, p.ac, s2);
      }
      pctx.restore();
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
      color: "#00eaff",
      border: "1px solid #00eaff",
      borderRadius: "3px",
      padding: "2px 14px",
      font: "12px monospace",
      letterSpacing: "2px",
      textTransform: "uppercase",
      cursor: "pointer",
      textShadow: "0 0 6px #00eaff",
      boxShadow: "0 0 8px rgba(0,234,255,.35), inset 0 0 8px rgba(0,234,255,.15)",
      transition: "box-shadow .15s, background .15s",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(0,234,255,.12)";
      btn.style.boxShadow = "0 0 14px rgba(0,234,255,.6), inset 0 0 10px rgba(0,234,255,.25)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "transparent";
      btn.style.boxShadow = "0 0 8px rgba(0,234,255,.35), inset 0 0 8px rgba(0,234,255,.15)";
    });
    container.appendChild(btn);

    // clicking the button loads the game and starts the first run right away
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
            crouchHeld = false;
            jumpHeld = false;
          }
        });
        io.observe(container);
      } else {
        startLoop();
      }

      reset();
      state = "run";                  // no idle screen on the first time
      canvas.focus({ preventScroll: true });
      sJump();
    }
    btn.addEventListener("click", bootAndStart);

    return {
      get canvas() { return booted ? canvas : null; },
      get score() { return score | 0; },
      get level() { return level; },
      get state() { return booted ? state : "waiting"; },
      get pageMode() { return pageMode; },
      get _dbg() { return { pageMode, escaping, ppx, ppy, pvy, pOnGround, pJumpBuf, PX, plats: plats.length, parts: pParticles.length }; },
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
        if (pageCanvas) unmountOverlay();
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

  global.game_instance = game_instance;
  if (typeof module !== "undefined" && module.exports) module.exports = game_instance;
})(typeof window !== "undefined" ? window : this);
