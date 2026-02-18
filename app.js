// Shuffleboard Scorer v2 - SIMPLIFIED
// Direct detection of red/blue puck plastic (no stickers needed!)

(() => {
  const BUILD = "v0.29";
  
  const $ = (sel) => document.querySelector(sel);
  const video = $("#video");
  const overlay = $("#overlay");
  const work = $("#work");
  const ctx = overlay.getContext("2d");
  const wctx = work.getContext("2d", { willReadFrequently: true });
  
  const statusPill = $("#statusPill");
  const panel = $("#panelControls");
  const blueTotalEl = $("#blueTotal");
  const redTotalEl = $("#redTotal");
  const gameSummaryEl = $("#gameSummary");
  const roundGridBody = $("#roundGridBody");
  const hintText = $("#hintText");
  const buildVersionEl = $("#buildVersion");
  if (buildVersionEl) buildVersionEl.textContent = BUILD;
  
  const LS_KEY = "shuffleboard_v2";
  const LS_HISTORY_KEY = "shuffleboard_v2_history";
  const LS_GAME_KEY = "shuffleboard_v2_game";

  // ========== SOUND EFFECTS (Web Audio API) ==========
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  let soundEnabled = true;
  const chkSfx = $("#chkSfx");
  if (chkSfx) chkSfx.addEventListener("change", () => { soundEnabled = chkSfx.checked; });

  // Short pitched tick — freq escalates as progress goes from 0→1
  function playTick(progress) {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      const freq = 300 + progress * 900; // 300 Hz → 1200 Hz
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch {}
  }

  // Celebratory fanfare for win popup
  function playWinFanfare() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.12;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.5);
      });
      // Final shimmer chord
      const shimmerTime = ctx.currentTime + notes.length * 0.12;
      [1047, 1319, 1568].forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, shimmerTime);
        gain.gain.exponentialRampToValueAtTime(0.001, shimmerTime + 1.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(shimmerTime);
        osc.stop(shimmerTime + 1.2);
      });
    } catch {}
  }

  // Sad descending tone for zero or negative round score
  function playSadSound() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      const notes = [392, 330, 262, 196]; // G4, E4, C4, G3 — descending
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.4);
      });
    } catch {}
  }

  // Happy double-ding for round score > 10
  function playHappyDing() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      [0, 0.15].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = 1047; // C6
        const t = ctx.currentTime + delay;
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.5);
      });
    } catch {}
  }

  // Extra flourish for round score > 20: ding ding + rising sparkle
  function playHappyDingFlourish() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      // Double ding
      [0, 0.15].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = 1047; // C6
        const t = ctx.currentTime + delay;
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.5);
      });
      // Rising sparkle arpeggio
      const sparkle = [1319, 1568, 1760, 2093]; // E6, G6, A6, C7
      sparkle.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = ctx.currentTime + 0.35 + i * 0.09;
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.6);
      });
    } catch {}
  }

  // Individual puck sounds: bad (-10 or 0), neutral (7 or 8), happy (10)
  function playBadPuck() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 160;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {}
  }

  function playNeutralPuck() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 660; // E5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {}
  }

  function playHappyPuck() {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 880; // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {}
  }

  function playPuckSound(points) {
    if (points <= 0) playBadPuck();
    else if (points === 10) playHappyPuck();
    else playNeutralPuck();
  }

  const State = {
    mode: "init",
    drag: null,
    config: null,
    game: null,
    detectCache: { ts: 0, pucks: [] },
    testImage: null,
    loopRunning: false,
  };

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || "[]"); }
    catch { return []; }
  }
  function saveToHistory(game) {
    const hist = loadHistory();
    hist.unshift(game);          // newest first
    while (hist.length > 10) hist.pop();
    try {
      localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(hist));
    } catch (e) {
      // Quota exceeded — clear history and try once more with just this game
      console.warn("Storage quota exceeded, clearing history", e);
      try {
        localStorage.setItem(LS_HISTORY_KEY, JSON.stringify([game]));
      } catch {
        localStorage.removeItem(LS_HISTORY_KEY);
      }
    }
  }

  function saveGame() {
    try {
      if (State.game && !State.game.ended) {
        // Strip screenshots to save space
        const lite = { ...State.game, rounds: State.game.rounds.map(r => ({ ...r, screenshot: null })) };
        localStorage.setItem(LS_GAME_KEY, JSON.stringify(lite));
      } else {
        localStorage.removeItem(LS_GAME_KEY);
      }
    } catch {}
  }
  function loadGame() {
    try {
      const raw = localStorage.getItem(LS_GAME_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function clearSavedGame() {
    localStorage.removeItem(LS_GAME_KEY);
  }

  // Simpler default config
  function defaultConfig() {
    return {
      puckRadius: 14,
      lineThickness: 2.5,
      touchEpsilon: 0,
      
      tri: {
        A: { x: 120, y: 120 },
        B: { x: 120, y: 480 },
        C: { x: 520, y: 300 },
      },
      
      lines: [
        { p1: { x: 430, y: 210 }, p2: { x: 430, y: 390 } },
        { p1: { x: 330, y: 210 }, p2: { x: 330, y: 420 } },
        { p1: { x: 230, y: 210 }, p2: { x: 230, y: 450 } },
      ],
      
      red: {
        hueCenter: 0,
        hueRange: 20,
        satMin: 0.40,
        valMin: 0.25,
      },
      
      blue: {
        hueCenter: 210,
        hueRange: 30,
        satMin: 0.40,
        valMin: 0.25,
      },
      
      detection: {
        minBlobArea: 200,
        maxBlobArea: 20000,
        minCircularity: 0.4,
      },

      distortion: {
        k: 0.02,    // radial radius-shrink coefficient
        p: 0.02,    // radial position pull-in coefficient
        // cx/cy: distortion centre in CSS-pixel space.
        // null = use frame centre. Drag the handle in calibration to adjust.
        cx: null,
        cy: null,
      },
    };
  }
  
  function loadConfig() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultConfig();
      return { ...defaultConfig(), ...JSON.parse(raw) };
    } catch {
      return defaultConfig();
    }
  }
  
  function saveConfig() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(State.config));
    } catch (e) {
      // Quota exceeded — clear history to free space, then retry
      console.warn("Storage quota exceeded on config save, clearing history", e);
      localStorage.removeItem(LS_HISTORY_KEY);
      try { localStorage.setItem(LS_KEY, JSON.stringify(State.config)); }
      catch { /* give up silently */ }
    }
  }
  
  function setStatus(text, kind="") {
    statusPill.textContent = text;
    statusPill.className = "status";
    if (kind === "ok") statusPill.classList.add("pill","ok");
    else if (kind === "warn") statusPill.classList.add("pill","warn");
    else if (kind === "bad") statusPill.classList.add("pill","bad");
  }
  
  // ========== CAMERA ==========
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      setStatus("Camera OK", "ok");
      resizeCanvases();
      State.loopRunning = true;
      requestAnimationFrame(loop);
    } catch (err) {
      console.error(err);
      setStatus("Camera blocked", "bad");
      panel.innerHTML = `<div class="hint">Camera access denied. Need HTTPS!</div>`;
    }
  }
  
  function resizeCanvases() {
    const rect = overlay.getBoundingClientRect();
    overlay.width = Math.round(rect.width * devicePixelRatio);
    overlay.height = Math.round(rect.height * devicePixelRatio);
    work.width = overlay.width;
    work.height = overlay.height;
  }
  window.addEventListener("resize", resizeCanvases);
  
  // ========== VIDEO COORDINATE MAPPING ==========
  //
  // Problem: video renders with object-fit:contain inside the canvas element,
  // creating letterbox bars.  drawImage(video, 0,0, W,H) STRETCHES the frame
  // to fill the canvas, so canvas pixels ≠ display pixels except at the center.
  // This causes puck circles to drift toward the edges.
  //
  // Fix: compute the same letterbox rect the browser uses, and draw the video
  // frame into the work canvas at that rect.  Then canvas pixel (cx,cy) always
  // corresponds to the same visual position in the overlay.
  //
  // Returns dimensions in CANVAS PHYSICAL PIXELS (not CSS pixels).

  function getSource() { return State.testImage || video; }

  function getVideoRect() {
    const src = State.testImage;
    const vW = src ? src.naturalWidth  : (video.videoWidth  || overlay.width  / devicePixelRatio);
    const vH = src ? src.naturalHeight : (video.videoHeight || overlay.height / devicePixelRatio);
    const cW = overlay.width;   // physical pixels
    const cH = overlay.height;

    const vAR = vW / vH;
    const cAR = cW / cH;

    let dW, dH, dX, dY;
    if (vAR > cAR) {
      // Video wider than canvas — bars on top and bottom
      dW = cW;
      dH = Math.round(cW / vAR);
      dX = 0;
      dY = Math.round((cH - dH) / 2);
    } else {
      // Video taller than canvas (or same) — bars on left and right
      dH = cH;
      dW = Math.round(cH * vAR);
      dX = Math.round((cW - dW) / 2);
      dY = 0;
    }

    return { x: dX, y: dY, w: dW, h: dH };
  }

  // ========== GEOMETRY ==========
  const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  
  function pointInTri(p, A, B, C) {
    const s = (p1,p2,p3) => (p1.x - p3.x)*(p2.y - p3.y) - (p2.x - p3.x)*(p1.y - p3.y);
    const b1 = s(p, A, B) < 0;
    const b2 = s(p, B, C) < 0;
    const b3 = s(p, C, A) < 0;
    return (b1 === b2) && (b2 === b3);
  }
  
  function distancePointToSegment(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const c1 = vx*wx + vy*wy;
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const c2 = vx*vx + vy*vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
    const t = c1 / c2;
    return Math.hypot(p.x - (a.x + t*vx), p.y - (a.y + t*vy));
  }
  
  function whichSide(p, a, b) {
    return (b.x - a.x)*(p.y - a.y) - (b.y - a.y)*(p.x - a.x);
  }
  
  function ensureTipIsC() {
    const { A, B, C } = State.config.tri;
    const verts = [
      { k:"A", ...A },
      { k:"B", ...B },
      { k:"C", ...C },
    ].sort((u,v) => v.x - u.x);
    const tip = verts[0];
    if (tip.k === "C") return;
    const other = verts.slice(1);
    State.config.tri = {
      A: { x: other[0].x, y: other[0].y },
      B: { x: other[1].x, y: other[1].y },
      C: { x: tip.x, y: tip.y },
    };
  }
  
  // ========== DISTORTION CORRECTION ==========
  // Shared helper: returns the distortion centre (cx, cy) and normalised
  // radial distance r ∈ [0,1] for a point (px, py) in CSS-pixel space.
  // The distortion centre defaults to the frame centre but can be dragged.
  function radialParams(px, py) {
    const cW = overlay.width  / devicePixelRatio;
    const cH = overlay.height / devicePixelRatio;
    const d  = State.config.distortion;
    // Use saved centre if set, otherwise frame centre
    const cx = (d && d.cx != null) ? d.cx : cW / 2;
    const cy = (d && d.cy != null) ? d.cy : cH / 2;
    // Normalise by distance from the chosen centre to the nearest corner
    const maxDist = Math.max(
      Math.hypot(cx,      cy),
      Math.hypot(cW - cx, cy),
      Math.hypot(cx,      cH - cy),
      Math.hypot(cW - cx, cH - cy),
    );
    const dx = px - cx;
    const dy = py - cy;
    const r  = Math.min(1, Math.hypot(dx, dy) / maxDist);
    return { cx, cy, dx, dy, r };
  }

  // Returns the effective collision radius (CSS px) for a puck at (px, py).
  // effectiveR = puckRadius * (1 - k * r²)
  function effectivePuckRadius(px, py) {
    const { puckRadius, distortion } = State.config;
    const k = distortion ? distortion.k : 0;
    if (!k) return puckRadius;
    const { r } = radialParams(px, py);
    return Math.max(4, puckRadius * (1 - k * r * r));
  }

  // Returns the lens-corrected position for a detected puck centre.
  // Barrel distortion pushes points outward; we pull them back in:
  //   corrected = centre + (raw - centre) * (1 - p * r²)
  // At the frame centre r=0 so nothing moves.
  // At the corners r≈1 so the point is pulled p*r² of the way back to centre.
  function correctPuckPosition(px, py) {
    const { distortion } = State.config;
    const p = distortion ? distortion.p : 0;
    if (!p) return { x: px, y: py };
    const { cx, cy, dx, dy, r } = radialParams(px, py);
    const scale = 1 - p * r * r;
    return { x: cx + dx * scale, y: cy + dy * scale };
  }
  function rgbToHsv(r,g,b){
    r/=255; g/=255; b/=255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      switch(max){
        case r: h = ((g-b)/d) % 6; break;
        case g: h = ((b-r)/d) + 2; break;
        case b: h = ((r-g)/d) + 4; break;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return {h,s,v};
  }

  function hsvToRgb(h,s,v){
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r,g,b;
    if      (h < 60)  { r=c; g=x; b=0; }
    else if (h < 120) { r=x; g=c; b=0; }
    else if (h < 180) { r=0; g=c; b=x; }
    else if (h < 240) { r=0; g=x; b=c; }
    else if (h < 300) { r=x; g=0; b=c; }
    else               { r=c; g=0; b=x; }
    return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
  }

  function hsvToHex(h,s,v){
    return '#' + hsvToRgb(h,s,v).map(c => c.toString(16).padStart(2,'0')).join('');
  }

  function hexToHsv(hex){
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return rgbToHsv(r,g,b);
  }

  // Representative display color for a puck team config
  function puckSwatchHex(teamCfg){
    return hsvToHex(teamCfg.hueCenter, Math.min(1, teamCfg.satMin / 0.7), Math.min(1, teamCfg.valMin / 0.7));
  }

  function hueDist(a,b){
    const d = Math.abs(a-b) % 360;
    return Math.min(d, 360-d);
  }
  
  // ========== PUCK DETECTION - COMPLETELY REWRITTEN ==========
  function detectPucks() {
    const W = overlay.width;
    const H = overlay.height;

    // Draw video into work canvas using the SAME letterbox geometry the
    // browser uses when rendering the <video> element.  Without this, a
    // 4:3 video in a non-4:3 container produces a coordinate warp that is
    // zero at the center but grows toward the edges.
    const vr = getVideoRect();
    wctx.clearRect(0, 0, W, H);
    wctx.drawImage(getSource(), vr.x, vr.y, vr.w, vr.h);
    const imageData = wctx.getImageData(0, 0, W, H);
    const data = imageData.data;
    
    // Get config
    const cfg = State.config;
    const redCfg = cfg.red;
    const blueCfg = cfg.blue;
    const detCfg = cfg.detection;
    
    // Create masks for red and blue pixels
    const redMask = new Uint8Array(W * H);
    const blueMask = new Uint8Array(W * H);
    
    // ROI check
    const useROI = State.mode !== "calibrate_triangle";
    let At, Bt, Ct;
    if (useROI) {
      ensureTipIsC();
      const A = cfg.tri.A, B = cfg.tri.B, C = cfg.tri.C;
      At = { x: A.x * devicePixelRatio, y: A.y * devicePixelRatio };
      Bt = { x: B.x * devicePixelRatio, y: B.y * devicePixelRatio };
      Ct = { x: C.x * devicePixelRatio, y: C.y * devicePixelRatio };
    }
    
    // Classify each pixel
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // ROI check
        if (useROI && !pointInTri({x,y}, At, Bt, Ct)) continue;
        
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i+1], b = data[i+2];
        
        // Skip very dark or very light pixels (metal center, glare)
        const brightness = (r + g + b) / 3;
        if (brightness < 30 || brightness > 240) continue;
        
        const hsv = rgbToHsv(r, g, b);
        
        // Check if it matches red
        if (hsv.s >= redCfg.satMin && hsv.v >= redCfg.valMin) {
          const hDist = hueDist(hsv.h, redCfg.hueCenter);
          if (hDist <= redCfg.hueRange) {
            // Extra check: red should actually look red (R > G and R > B)
            if (r > g + 10 && r > b + 10) {
              redMask[y * W + x] = 1;
            }
          }
        }
        
        // Check if it matches blue
        if (hsv.s >= blueCfg.satMin && hsv.v >= blueCfg.valMin) {
          const hDist = hueDist(hsv.h, blueCfg.hueCenter);
          if (hDist <= blueCfg.hueRange) {
            // Extra check: blue should actually look blue (B > R and B > G)
            if (b > r + 10 && b > g + 10) {
              blueMask[y * W + x] = 1;
            }
          }
        }
      }
    }
    
    // Find blobs using flood fill
    function findBlobs(mask, team) {
      const visited = new Uint8Array(mask.length);
      const blobs = [];
      
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!mask[i] || visited[i]) continue;
          
          // Flood fill to find connected component
          const stack = [i];
          visited[i] = 1;
          
          let area = 0, sumX = 0, sumY = 0;
          let minX = x, maxX = x, minY = y, maxY = y;
          
          while (stack.length > 0) {
            const idx = stack.pop();
            const px = idx % W;
            const py = Math.floor(idx / W);
            
            area++;
            sumX += px;
            sumY += py;
            
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
            
            // Check 4 neighbors
            const neighbors = [
              idx - W,     // up
              idx + W,     // down
              idx - 1,     // left
              idx + 1,     // right
            ];
            
            for (const ni of neighbors) {
              if (ni < 0 || ni >= mask.length) continue;
              const nx = ni % W;
              const ny = Math.floor(ni / W);
              
              // Boundary check
              if (Math.abs(nx - px) > 1 || Math.abs(ny - py) > 1) continue;
              
              if (mask[ni] && !visited[ni]) {
                visited[ni] = 1;
                stack.push(ni);
              }
            }
          }
          
          // Calculate blob properties
          const cx = sumX / area;
          const cy = sumY / area;
          const w = maxX - minX + 1;
          const h = maxY - minY + 1;
          
          // Circularity: how close to a circle is this blob?
          // Perfect circle: area = π*r², perimeter = 2*π*r
          // Circularity = 4*π*area / perimeter²
          // For our purposes, we'll use a simpler metric: area / (w*h)
          const circularity = area / (w * h);
          
          blobs.push({
            team,
            x: cx / devicePixelRatio,
            y: cy / devicePixelRatio,
            area,
            width: w,
            height: h,
            circularity,
          });
        }
      }
      
      return blobs;
    }
    
    const redBlobs = findBlobs(redMask, "red");
    const blueBlobs = findBlobs(blueMask, "blue");
    
    // Filter blobs
    function filterBlobs(blobs) {
      return blobs.filter(b => {
        // Area check
        if (b.area < detCfg.minBlobArea || b.area > detCfg.maxBlobArea) return false;
        
        // Circularity check
        if (b.circularity < detCfg.minCircularity) return false;
        
        // Aspect ratio check (should be roughly circular)
        const ar = b.width / b.height;
        if (ar < 0.5 || ar > 2.0) return false;
        
        return true;
      }).map(b => {
        // Apply radial position correction before anything else uses the coords.
        // Both the overlay circle and the collision check will use corrected x,y.
        const corrected = correctPuckPosition(b.x, b.y);
        return {
          team: b.team,
          x: corrected.x,
          y: corrected.y,
          _rawX: b.x,   // keep for debug
          _rawY: b.y,
          radius: State.config.puckRadius,
          _debug: { area: b.area, circ: b.circularity.toFixed(2) }
        };
      }).sort((a,b) => b._debug.area - a._debug.area).slice(0, 8);
    }
    
    const redPucks = filterBlobs(redBlobs);
    const bluePucks = filterBlobs(blueBlobs);
    
    const allPucks = [...redPucks, ...bluePucks];
    allPucks._debug = {
      redBlobs: redBlobs.length,
      blueBlobs: blueBlobs.length,
      redPucks: redPucks.length,
      bluePucks: bluePucks.length,
    };
    
    return allPucks;
  }
  
  // ========== SCORING ==========
  function scoreRound(pucks) {
    ensureTipIsC();
    const { tri, lines, lineThickness, touchEpsilon } = State.config;
    const { A, B, C } = tri;

    const edges = [
      {a:A, b:B},
      {a:B, b:C},
      {a:C, b:A},
    ];

    const tip = C;
    const tipSide = lines.map(L => Math.sign(whichSide(tip, L.p1, L.p2)) || 1);

    const results = [];

    for (const puck of pucks) {
      const center = { x: puck.x, y: puck.y };

      // Per-puck collision radius — accounts for radial lens distortion
      const effR = effectivePuckRadius(puck.x, puck.y);
      const minClear = effR + (lineThickness / 2) + touchEpsilon;

      // Check outer triangle edges
      let touchesEdge = false;
      let edgeMargin = Infinity;
      for (const edge of edges) {
        const d = distancePointToSegment(center, edge.a, edge.b);
        if (d < minClear) {
          touchesEdge = true;
          edgeMargin = Math.min(edgeMargin, minClear - d);
        }
      }

      if (touchesEdge) {
        const margin = edgeMargin;
        let altPoints = 0;
        // If close call and center is inside triangle, calculate what zone it would score
        if (margin <= 3 && pointInTri(center, A, B, C)) {
          altPoints = 10;
          for (let j = 0; j < lines.length; j++) {
            const dLine = distancePointToSegment(center, lines[j].p1, lines[j].p2);
            if (dLine < minClear) { altPoints = 0; break; }
            const s = Math.sign(whichSide(center, lines[j].p1, lines[j].p2)) || 1;
            if (s !== tipSide[j]) {
              if (j === 0) altPoints = 8;
              else if (j === 1) altPoints = 7;
              else altPoints = -10;
            }
          }
        }
        results.push({ ...puck, points: 0, valid: false, zone: "out", effR, lineMargin: margin, altPoints });
        continue;
      }

      // Must be inside triangle
      if (!pointInTri(center, A, B, C)) {
        results.push({ ...puck, points: 0, valid: false, zone: "out", effR });
        continue;
      }

      // Determine scoring zone by checking boundary lines
      let zone = 10;

      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        const distToLine = distancePointToSegment(center, L.p1, L.p2);

        if (distToLine < minClear) {
          const lineMargin = minClear - distToLine;
          // Calculate what zone the puck would be in ignoring line contact
          let altZone = 10;
          for (let j = 0; j < lines.length; j++) {
            const s = Math.sign(whichSide(center, lines[j].p1, lines[j].p2)) || 1;
            if (s !== tipSide[j]) {
              if (j === 0) altZone = 8;
              else if (j === 1) altZone = 7;
              else altZone = -10;
            }
          }
          results.push({ ...puck, points: 0, valid: false, zone: "line", effR, lineMargin, altPoints: altZone });
          zone = null;
          break;
        }

        const side = Math.sign(whichSide(center, L.p1, L.p2)) || 1;
        if (side !== tipSide[i]) {
          if (i === 0) zone = 8;
          else if (i === 1) zone = 7;
          else zone = -10;
        }
      }

      if (zone !== null) {
        results.push({ ...puck, points: zone, valid: true, zone: `${zone}pt`, effR });
      }
    }

    const sum = { red: 0, blue: 0 };
    for (const r of results) {
      if (r.valid) sum[r.team] += r.points;
    }

    return { results, sum };
  }
  
  // ========== UI RENDERING ==========
  function renderPanel() {
    const cfg = State.config;
    const mode = State.mode;
    
    const common = `
      <div class="row">
        <label>Line thickness</label>
        <div class="grow"><input id="lineThickness" type="range" min="0.5" max="5" step="0.5" value="${cfg.lineThickness}" /></div>
        <div class="badge">${cfg.lineThickness}px</div>
      </div>
      <div class="row">
        <label>Touch tolerance</label>
        <div class="grow"><input id="touchEpsilon" type="range" min="0" max="5" step="0.5" value="${cfg.touchEpsilon}" /></div>
        <div class="badge">${cfg.touchEpsilon}px</div>
      </div>
    `;
    
    if (mode === "calibrate_triangle") {
      return `
        <h3>Step 1/3: Triangle</h3>
        <div class="hint">Drag the three corner points to match your board's triangle.</div>
        ${common}
        <div class="row">
          <button class="btn primary grow" id="btnNext">Next: Lines</button>
        </div>
        <div class="sep"></div>
        <div class="row">
          <button class="btn ghost grow" id="btnSaveCal">Save Calibration</button>
          <button class="btn ghost grow" id="btnLoadCal">Load Calibration</button>
        </div>
      `;
    }
    
    if (mode === "calibrate_lines") {
      return `
        <h3>Step 2/3: Boundaries</h3>
        <div class="hint">Drag the line segments to match the score boundaries (10|8, 8|7, 7|-10).</div>
        ${common}
        <div class="row">
          <button class="btn grow" id="btnBack">Back</button>
          <button class="btn primary grow" id="btnNext">Next: Colors</button>
        </div>
        <div class="sep"></div>
        <div class="row">
          <button class="btn ghost grow" id="btnSaveCal">Save Calibration</button>
          <button class="btn ghost grow" id="btnLoadCal">Load Calibration</button>
        </div>
      `;
    }
    
    if (mode === "calibrate_colors") {
      const k = cfg.distortion ? cfg.distortion.k : 0;
      const redHex = puckSwatchHex(cfg.red);
      const blueHex = puckSwatchHex(cfg.blue);
      return `
        <h3>Step 3/3: Puck Colors</h3>
        <div class="hint">
          Click <b>Sample</b> then click on the puck, or click the <b>color swatch</b> to pick manually.
        </div>
        <div class="row">
          <label>Puck radius</label>
          <div class="grow"><input id="puckRadius" type="range" min="10" max="50" step="1" value="${cfg.puckRadius}" /></div>
          <div class="badge">${cfg.puckRadius}px</div>
        </div>
        <div class="sep"></div>
        <div class="row">
          <input type="color" id="redColorPicker" value="${redHex}" title="Pick red color" style="width:36px;height:36px;padding:0;border:2px solid #5a2a2a;border-radius:6px;cursor:pointer;background:none;" />
          <button class="btn grow" id="btnSampleRed">Sample Red Puck</button>
        </div>
        <div class="row">
          <input type="color" id="blueColorPicker" value="${blueHex}" title="Pick blue color" style="width:36px;height:36px;padding:0;border:2px solid #234562;border-radius:6px;cursor:pointer;background:none;" />
          <button class="btn grow" id="btnSampleBlue">Sample Blue Puck</button>
        </div>
        <div class="sep"></div>
        <div class="hint"><b>Lens distortion correction</b><br/>
          <b>Edge shrink</b> shrinks the collision radius toward edges.
          <b>Position pull-in</b> nudges centres back toward the frame centre.
        </div>
        <div class="row">
          <label>Edge shrink (k)</label>
          <div class="grow"><input id="distortionK" type="range" min="0" max="0.2" step="0.001" value="${k.toFixed(3)}" /></div>
          <div class="badge" id="distortionKBadge">${(k * 100).toFixed(1)}%</div>
        </div>
        <div class="row">
          <label>Position pull-in (p)</label>
          <div class="grow"><input id="distortionP" type="range" min="0" max="0.1" step="0.001" value="${(cfg.distortion?.p ?? 0).toFixed(3)}" /></div>
          <div class="badge" id="distortionPBadge">${((cfg.distortion?.p ?? 0) * 100).toFixed(1)}%</div>
        </div>
        <div class="sep"></div>
        <div class="hint"><b>Color fine-tuning</b> (if detection isn't working)</div>
        <div class="row">
          <label>Red hue range</label>
          <div class="grow"><input id="redHueRange" type="range" min="10" max="60" step="5" value="${cfg.red.hueRange}" /></div>
          <div class="badge">±${cfg.red.hueRange}°</div>
        </div>
        <div class="row">
          <label>Blue hue range</label>
          <div class="grow"><input id="blueHueRange" type="range" min="10" max="60" step="5" value="${cfg.blue.hueRange}" /></div>
          <div class="badge">±${cfg.blue.hueRange}°</div>
        </div>
        <div class="row">
          <label>Min saturation</label>
          <div class="grow"><input id="satMin" type="range" min="0.1" max="0.8" step="0.05" value="${cfg.red.satMin}" /></div>
          <div class="badge">${cfg.red.satMin.toFixed(2)}</div>
        </div>
        <div class="row">
          <label>Min brightness</label>
          <div class="grow"><input id="valMin" type="range" min="0.1" max="0.8" step="0.05" value="${cfg.red.valMin}" /></div>
          <div class="badge">${cfg.red.valMin.toFixed(2)}</div>
        </div>
        ${common}
        <div class="sep"></div>
        <div class="row">
          <button class="btn ghost grow" id="btnSaveCal">Save Calibration</button>
          <button class="btn ghost grow" id="btnLoadCal">Load Calibration</button>
        </div>
        <div class="row">
          <button class="btn grow" id="btnBack">Back</button>
          <button class="btn primary grow" id="btnFinish">Finish</button>
        </div>
      `;
    }
    
    if (mode === "ready") {
      return `
        <h3>Ready!</h3>
        <div class="hint">Calibration complete. Start a game to begin automatic scoring.</div>
        <div class="row">
          <button class="btn scoreRound grow" id="btnStartGame">Start Game</button>
        </div>
        <div class="row">
          <button class="btn ghost grow" id="btnHistory">Game History</button>
        </div>
      `;
    }
    
    if (mode === "game_setup") {
      const goalType   = State._setupGoalType   ?? "points";
      const goalPoints = State._setupGoalPoints  ?? 75;
      const goalRounds = State._setupGoalRounds  ?? 5;
      const ptActive = goalType === "points";
      return `
        <h3>New Game</h3>
        <div class="row" style="gap:0;margin-bottom:4px">
          <button id="btnGoalPoints" class="btn grow${ptActive ? " primary" : ""}" style="border-radius:8px 0 0 8px;border-right:none">Points</button>
          <button id="btnGoalRounds" class="btn grow${!ptActive ? " primary" : ""}" style="border-radius:0 8px 8px 0">Rounds</button>
        </div>
        ${ptActive ? `
        <div class="row">
          <label style="font-size:18px;font-weight:700;width:auto">Point goal</label>
          <div class="grow"><input id="goalPoints" type="range" min="5" max="150" step="5" value="${goalPoints}" /></div>
          <div class="badge" id="goalPointsBadge" style="font-size:18px;font-weight:700;padding:6px 12px">${goalPoints} pts</div>
        </div>` : `
        <div class="row">
          <label style="font-size:18px;font-weight:700;width:auto">Round goal</label>
          <div class="grow"><input id="goalRounds" type="range" min="1" max="10" step="1" value="${goalRounds}" /></div>
          <div class="badge" id="goalRoundsBadge" style="font-size:18px;font-weight:700;padding:6px 12px">${goalRounds} rnds</div>
        </div>`}
        <div class="row">
          <button class="btn grow" id="btnCancelGame">Cancel</button>
          <button class="btn primary grow" id="btnBeginGame">Begin</button>
        </div>
      `;
    }
    
    if (mode === "game") {
      return `
        <h3>Game Controls</h3>
        <div class="hint">When all pucks have stopped, click <b>Score Round</b>.<br/>Press <b>Space</b> on a keyboard as a shortcut.</div>
        <div class="row">
          <button class="btn scoreRound grow" id="btnScoreRound">Score Round</button>
        </div>
        <div class="row">
          <button class="btn grow" id="btnUndoRound">Undo Last</button>
          <button class="btn danger grow" id="btnEndGame">End Game</button>
        </div>
      `;
    }
    
    return `<h3>Loading...</h3>`;
  }
  
  function wirePanelEvents() {
    const lt = $("#lineThickness");
    if (lt) lt.oninput = (e) => { State.config.lineThickness = Number(e.target.value); saveConfig(); };
    
    const te = $("#touchEpsilon");
    if (te) te.oninput = (e) => { State.config.touchEpsilon = Number(e.target.value); saveConfig(); };
    
    const pr = $("#puckRadius");
    if (pr) pr.oninput = (e) => { State.config.puckRadius = Number(e.target.value); saveConfig(); };
    
    const rhr = $("#redHueRange");
    if (rhr) rhr.oninput = (e) => { State.config.red.hueRange = Number(e.target.value); saveConfig(); };
    
    const bhr = $("#blueHueRange");
    if (bhr) bhr.oninput = (e) => { State.config.blue.hueRange = Number(e.target.value); saveConfig(); };
    
    const sm = $("#satMin");
    if (sm) sm.oninput = (e) => { 
      State.config.red.satMin = State.config.blue.satMin = Number(e.target.value); 
      saveConfig(); 
    };
    
    const vm = $("#valMin");
    if (vm) vm.oninput = (e) => { 
      State.config.red.valMin = State.config.blue.valMin = Number(e.target.value); 
      saveConfig(); 
    };

    const dkEl = $("#distortionK");
    if (dkEl) dkEl.oninput = (e) => {
      if (!State.config.distortion) State.config.distortion = { k: 0, p: 0, cx: null, cy: null };
      State.config.distortion.k = Number(e.target.value);
      const badge = $("#distortionKBadge");
      if (badge) badge.textContent = (State.config.distortion.k * 100).toFixed(1) + "%";
      saveConfig();
    };

    const dpEl = $("#distortionP");
    if (dpEl) dpEl.oninput = (e) => {
      if (!State.config.distortion) State.config.distortion = { k: 0, p: 0, cx: null, cy: null };
      State.config.distortion.p = Number(e.target.value);
      const badge = $("#distortionPBadge");
      if (badge) badge.textContent = (State.config.distortion.p * 100).toFixed(1) + "%";
      saveConfig();
    };
    
    const btnNext = $("#btnNext");
    if (btnNext) btnNext.onclick = () => {
      if (State.mode === "calibrate_triangle") State.mode = "calibrate_lines";
      else if (State.mode === "calibrate_lines") State.mode = "calibrate_colors";
      render();
    };
    
    const btnBack = $("#btnBack");
    if (btnBack) btnBack.onclick = () => {
      if (State.mode === "calibrate_lines") State.mode = "calibrate_triangle";
      else if (State.mode === "calibrate_colors") State.mode = "calibrate_lines";
      render();
    };
    
    const btnFinish = $("#btnFinish");
    if (btnFinish) btnFinish.onclick = () => {
      saveConfig();
      const savedGame = loadGame();
      if (savedGame && !savedGame.ended) {
        State.game = savedGame;
        State.mode = "game";
        hintText.textContent = "Calibration updated — game resumed!";
      } else {
        State.mode = "ready";
        hintText.textContent = "Calibration complete!";
      }
      updateScoreboard();
      render();
    };
    
    const btnStart = $("#btnStartGame");
    if (btnStart) btnStart.onclick = () => { State.mode = "game_setup"; render(); };

    const btnHistory = $("#btnHistory");
    if (btnHistory) btnHistory.onclick = () => showHistoryPopup();

    const btnGoalPoints = $("#btnGoalPoints");
    if (btnGoalPoints) btnGoalPoints.onclick = () => {
      State._setupGoalType = "points";
      render();
    };
    const btnGoalRounds = $("#btnGoalRounds");
    if (btnGoalRounds) btnGoalRounds.onclick = () => {
      State._setupGoalType = "rounds";
      render();
    };

    // Game setup sliders
    const gpEl = $("#goalPoints");
    if (gpEl) {
      gpEl.oninput = (e) => {
        State._setupGoalPoints = Number(e.target.value);
        const b = $("#goalPointsBadge");
        if (b) b.textContent = e.target.value + " pts";
      };
    }
    const grEl = $("#goalRounds");
    if (grEl) {
      grEl.oninput = (e) => {
        State._setupGoalRounds = Number(e.target.value);
        const b = $("#goalRoundsBadge");
        if (b) b.textContent = e.target.value + " rnds";
      };
    }
    
    const btnCancel = $("#btnCancelGame");
    if (btnCancel) btnCancel.onclick = () => { State.mode = "ready"; render(); };
    
    const btnBegin = $("#btnBeginGame");
    if (btnBegin) btnBegin.onclick = () => {
      const goalType   = State._setupGoalType   ?? "points";
      const goalPoints = goalType === "points" ? (State._setupGoalPoints ?? 75) : 0;
      const goalRounds = goalType === "rounds" ? (State._setupGoalRounds ?? 5)  : 0;
      State.game = {
        id: Date.now(),
        goalType,
        goalPoints,
        goalRounds,
        rounds: [],
        totals: { red:0, blue:0 },
        startedAt: Date.now(),
        ended: false,
      };
      State.mode = "game";
      saveGame();
      updateScoreboard();
      render();
    };
    
    const btnScore = $("#btnScoreRound");
    if (btnScore) btnScore.onclick = () => doScoreRound();
    
    const btnUndo = $("#btnUndoRound");
    if (btnUndo) btnUndo.onclick = () => {
      if (!State.game || State.game.rounds.length === 0) return;
      const last = State.game.rounds.pop();
      State.game.totals.blue -= last.blue;
      State.game.totals.red  -= last.red;
      updateScoreboard();
      saveGame();
    };

    const btnEnd = $("#btnEndGame");
    if (btnEnd) btnEnd.onclick = () => {
      if (!State.game) return;
      if (!isGoalMet(State.game) && !confirm("End game early? This will save it to history.")) return;
      if (!State.game.ended) {
        State.game.ended   = true;
        State.game.endedAt = Date.now();
        saveToHistory(State.game);
      }
      State.mode = "ready";
      State.game = null;
      clearSavedGame();
      updateScoreboard();
      render();
    };
    
    const btnSampleRed = $("#btnSampleRed");
    if (btnSampleRed) btnSampleRed.onclick = () => {
      State.drag = { type:"sample", team:"red" };
      hintText.textContent = "Click on the RED puck's colored plastic...";
    };

    const btnSampleBlue = $("#btnSampleBlue");
    if (btnSampleBlue) btnSampleBlue.onclick = () => {
      State.drag = { type:"sample", team:"blue" };
      hintText.textContent = "Click on the BLUE puck's colored plastic...";
    };

    // Color pickers
    const redPicker = $("#redColorPicker");
    if (redPicker) redPicker.oninput = (e) => {
      const hsv = hexToHsv(e.target.value);
      State.config.red.hueCenter = Math.round(hsv.h);
      State.config.red.satMin = Math.max(0.2, hsv.s * 0.7);
      State.config.red.valMin = Math.max(0.15, hsv.v * 0.7);
      saveConfig();
      hintText.textContent = `Red set: H=${Math.round(hsv.h)}° S=${hsv.s.toFixed(2)} V=${hsv.v.toFixed(2)}`;
    };

    const bluePicker = $("#blueColorPicker");
    if (bluePicker) bluePicker.oninput = (e) => {
      const hsv = hexToHsv(e.target.value);
      State.config.blue.hueCenter = Math.round(hsv.h);
      State.config.blue.satMin = Math.max(0.2, hsv.s * 0.7);
      State.config.blue.valMin = Math.max(0.15, hsv.v * 0.7);
      saveConfig();
      hintText.textContent = `Blue set: H=${Math.round(hsv.h)}° S=${hsv.s.toFixed(2)} V=${hsv.v.toFixed(2)}`;
    };

    // Save / Load calibration
    const btnSave = $("#btnSaveCal");
    if (btnSave) btnSave.onclick = () => {
      const json = JSON.stringify(State.config, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "shuffleboard-calibration.json";
      a.click();
      URL.revokeObjectURL(a.href);
    };

    const btnLoad = $("#btnLoadCal");
    if (btnLoad) {
      const loadInput = document.createElement("input");
      loadInput.type = "file";
      loadInput.accept = ".json,application/json";
      loadInput.style.display = "none";
      loadInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const imported = JSON.parse(ev.target.result);
            State.config = { ...defaultConfig(), ...imported };
            saveConfig();
            render();
            hintText.textContent = "Calibration loaded from " + file.name;
          } catch (err) {
            alert("Invalid calibration file: " + err.message);
          }
        };
        reader.readAsText(file);
        loadInput.value = "";
      };
      btnLoad.onclick = () => loadInput.click();
    }
  }
  
  function updateScoreboard() {
    const g = State.game;
    if (!g) {
      blueTotalEl.textContent = "0";
      redTotalEl.textContent = "0";
      gameSummaryEl.textContent = "Not started";
      roundGridBody.innerHTML = "";
      return;
    }
    blueTotalEl.textContent = String(g.totals.blue);
    redTotalEl.textContent = String(g.totals.red);

    const goalParts = [];
    if (g.goalType === "points" && g.goalPoints > 0) goalParts.push(g.goalPoints + " pts");
    if (g.goalType === "rounds" && g.goalRounds > 0) goalParts.push(g.goalRounds + " rnds");
    const goalStr = goalParts.length ? goalParts.join(" · ") : "no limit";
    gameSummaryEl.textContent = (g.ended ? "Ended" : "In progress") + " • " + goalStr;

    roundGridBody.innerHTML = "";
    g.rounds.forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      tr.title = "Click to view screenshot";
      tr.innerHTML = `
        <td>${idx+1}</td>
        <td class="blue">${r.blue}</td>
        <td class="red">${r.red}</td>
      `;
      if (r.screenshot) {
        tr.onclick = () => showRoundPopup(r, idx + 1);
      }
      roundGridBody.appendChild(tr);
    });

    // Goal-reached check is handled by showScoreAnimation dismiss callback
  }
  
  // Pure number check — does not care whether the game is already marked ended
  function isGoalMet(g) {
    if (!g) return false;
    if (g.goalType === "points" && g.goalPoints > 0 && (g.totals.blue >= g.goalPoints || g.totals.red >= g.goalPoints)) return true;
    if (g.goalType === "rounds" && g.goalRounds > 0 && g.rounds.length >= g.goalRounds) return true;
    return false;
  }

  function endGameIfGoalReached() {
    const g = State.game;
    if (!g || g.ended) return;
    if (isGoalMet(g)) {
      g.ended = true;
      g.endedAt = Date.now();
      saveToHistory(g);
      showWinnerPopup(g);
    }
  }

  function captureScreenshot() {
    try {
      const c = document.createElement("canvas");
      c.width  = overlay.width;
      c.height = overlay.height;
      const x  = c.getContext("2d");
      const vr = getVideoRect();
      x.drawImage(getSource(), vr.x, vr.y, vr.w, vr.h);
      x.drawImage(overlay, 0, 0);
      return c.toDataURL("image/jpeg", 0.75);
    } catch { return null; }
  }

  function doScoreRound() {
    if (!State.game || State.mode !== "game") return;

    const screenshot = captureScreenshot();
    const pucks = detectPucks();
    const scored = scoreRound(pucks);

    // Store individual puck scores for the breakdown display
    // Include all detected pucks; mark borderline ones (edge/line by <= 3px) as questionable
    const puckScores = scored.results.map(r => {
      const base = { team: r.team, points: r.points };
      if (r.lineMargin !== undefined && r.lineMargin <= 3 && r.altPoints && r.altPoints !== 0) {
        base.questionable = true;
        base.altPoints = r.altPoints;
      }
      return base;
    });

    const round = {
      blue: scored.sum.blue,
      red:  scored.sum.red,
      ts:   Date.now(),
      screenshot,
      puckScores,
    };

    State.game.rounds.push(round);
    State.game.totals.blue += scored.sum.blue;
    State.game.totals.red  += scored.sum.red;

    updateScoreboard();
    saveGame();
    showScoreAnimation(round, State.game.rounds.length);
  }
  
  window.addEventListener("keydown", (e) => {
    // Escape: undo popup if open, otherwise undo last round
    if (e.code === "Escape") {
      const scoreAnimPopup = document.querySelector("[data-popup-type='scoreAnim']");
      if (scoreAnimPopup && scoreAnimPopup._undo) {
        e.preventDefault();
        scoreAnimPopup._undo();
        return;
      }
      const btnUndo = $("#btnUndoRound");
      if (btnUndo) {
        e.preventDefault();
        btnUndo.click();
        return;
      }
    }
    if (e.code === "Space") {
      e.preventDefault();
      // If score animation popup is open, dismiss it (only works after animation)
      const scoreAnimPopup = document.querySelector("[data-popup-type='scoreAnim']");
      if (scoreAnimPopup) {
        if (scoreAnimPopup._dismiss) scoreAnimPopup._dismiss();
        return;
      }
      // If winner popup is open, click the New Game button
      const winnerPopup = document.querySelector("[data-popup-type='winner']");
      if (winnerPopup) {
        const newGameBtn = winnerPopup.querySelector("#btnNewGameFromWinner");
        if (newGameBtn) newGameBtn.click();
        return;
      }
      // Ready state → Start Game
      if (State.mode === "ready") {
        const btn = $("#btnStartGame");
        if (btn) { btn.click(); return; }
      }
      // Game setup → Begin
      if (State.mode === "game_setup") {
        const btn = $("#btnBeginGame");
        if (btn) { btn.click(); return; }
      }
      if (State.mode === "game") doScoreRound();
    }
  });
  
  $("#btnRecalibrate").onclick = () => {
    saveGame();
    State.mode = "calibrate_triangle";
    render();
  };

  $("#btnResetAll").onclick = () => {
    if (!confirm("Reset calibration? Game history is kept.")) return;
    if (State.game && !State.game.ended && State.game.rounds.length > 0) {
      State.game.ended  = true;
      State.game.endedAt = Date.now();
      saveToHistory(State.game);
    }
    State.game = null;
    clearSavedGame();
    State.config = defaultConfig();
    saveConfig();
    State.mode = "calibrate_triangle";
    updateScoreboard();
    render();
  };

  // ========== TEST IMAGE ==========
  const testImageInput = $("#testImageInput");
  const btnTest = $("#btnTest");

  btnTest.onclick = () => {
    if (State.testImage) {
      // Switch back to camera
      State.testImage = null;
      video.style.display = "";
      btnTest.textContent = "Test";
      State.detectCache = { ts: 0, pucks: [] };
      if (video.srcObject) setStatus("Camera OK", "ok");
      else setStatus("Camera blocked", "bad");
    } else {
      testImageInput.click();
    }
  };

  testImageInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      State.testImage = img;
      State.detectCache = { ts: 0, pucks: [] };
      video.style.display = "none";
      btnTest.textContent = "Camera";
      setStatus("Test Image", "warn");
      // Ensure the render loop is running (camera may have failed)
      if (!State.loopRunning) {
        State.loopRunning = true;
        resizeCanvases();
        requestAnimationFrame(loop);
      }
    };
    img.src = URL.createObjectURL(file);
    testImageInput.value = ""; // allow re-selecting the same file
  };

  // ========== POPUPS ==========

  function makeModal(content, onClose) {
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position:"fixed", inset:"0", background:"rgba(0,0,0,0.82)",
      zIndex:"1000", display:"flex", alignItems:"center", justifyContent:"center",
      padding:"16px", boxSizing:"border-box",
    });
    backdrop.innerHTML = content;
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) { backdrop.remove(); if (onClose) onClose(); }
    });
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function showScoreAnimation(round, roundNum) {
    const g = State.game;
    const blueTotal = g ? g.totals.blue : 0;
    const redTotal  = g ? g.totals.red  : 0;

    // Remaining-goal string
    let remainStr = "";
    if (g) {
      if (g.goalType === "points") {
        const leader = Math.max(blueTotal, redTotal);
        const rem    = Math.max(0, g.goalPoints - leader);
        remainStr = rem === 0 ? "🏆 Goal reached!" : `${rem} pts to go`;
      } else {
        const rem = Math.max(0, g.goalRounds - roundNum);
        remainStr = rem === 0 ? "🏆 Final round!" : `${rem} round${rem !== 1 ? "s" : ""} remaining`;
      }
    }

    const img = round.screenshot
      ? `<img src="${round.screenshot}" style="width:100%;border-radius:12px;display:block;margin-bottom:18px;max-height:380px;object-fit:cover;" />`
      : "";

    const pucks = round.puckScores || [];
    const bluePucks = pucks.filter(p => p.team === "blue").sort((a,b) => b.points - a.points);
    const redPucks  = pucks.filter(p => p.team === "red").sort((a,b) => b.points - a.points);

    let undone = false;
    let dismissed = false;
    let animating = true;
    const pendingTimers = [];

    // Cancellable setTimeout wrapper
    function scheduleTimer(fn, ms) {
      const id = setTimeout(fn, ms);
      pendingTimers.push(id);
      return id;
    }

    function cancelAllTimers() {
      pendingTimers.forEach(id => clearTimeout(id));
      pendingTimers.length = 0;
    }

    const modal = document.createElement("div");
    Object.assign(modal.style, {
      position:"fixed", inset:"0", background:"rgba(0,0,0,0.3)",
      zIndex:"1000", display:"flex", alignItems:"center", justifyContent:"flex-end",
      padding:"16px", paddingRight:"24px", boxSizing:"border-box",
    });
    modal.dataset.popupType = "scoreAnim";
    modal.innerHTML = `
      <div id="scoreAnim" style="
        background:#0b1520; border:1px solid #223140; border-radius:20px;
        padding:28px 32px; text-align:center; width:min(42vw,520px);
        font-family:-apple-system,system-ui,sans-serif; color:#e7eef7;
        max-height:95vh; overflow-y:auto; position:relative;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <div style="font-size:16px;letter-spacing:1.5px;color:#9fb0c2;text-transform:uppercase;font-weight:700">Round ${roundNum}</div>
          <button id="btnUndoScoreAnim" style="
            background:#401a1a;border:1px solid #6a2b2b;color:#ffd2d8;
            padding:6px 16px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;
          ">Undo</button>
        </div>
        ${img}

        <!-- Round breakdown: blue left, red right -->
        <div style="display:flex;gap:0;margin-bottom:6px;border:1px solid #1e3040;border-radius:12px;overflow:hidden">
          <div style="flex:1;background:#0d1f31;display:flex;flex-direction:column">
            <div id="blueEquation" style="padding:12px 10px;font-size:22px;color:#4aa3ff;min-height:40px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;flex:1"></div>
            <div id="blueTotalRow" style="padding:14px 0;background:#0a1525;border-top:1px solid #1e3040;opacity:0;transition:opacity .3s">
              <div id="animBlue" style="font-size:48px;font-weight:900;color:#4aa3ff;line-height:1">0</div>
            </div>
          </div>
          <div style="width:1px;background:#1e3040"></div>
          <div style="flex:1;background:#0d1f31;display:flex;flex-direction:column">
            <div id="redEquation" style="padding:12px 10px;font-size:22px;color:#ff5b5b;min-height:40px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;flex:1"></div>
            <div id="redTotalRow" style="padding:14px 0;background:#0a1525;border-top:1px solid #1e3040;opacity:0;transition:opacity .3s">
              <div id="animRed" style="font-size:48px;font-weight:900;color:#ff5b5b;line-height:1">0</div>
            </div>
          </div>
        </div>

        <!-- Running totals — appear after puck reveals -->
        <div id="totalsBlock" style="opacity:0;transition:opacity .4s;margin-bottom:6px;border:1px solid #1e3040;border-radius:12px;overflow:hidden">
          <div style="display:flex;gap:0;align-items:stretch">
            <div style="flex:1;padding:10px 0;background:#071220">
              <div style="font-size:9px;letter-spacing:1px;color:#4aa3ff;margin-bottom:2px">TOTAL</div>
              <div id="animBlueTotal" style="font-size:64px;font-weight:900;color:#4aa3ff;line-height:1">0</div>
            </div>
            <div style="width:1px;background:#1e3040"></div>
            <div style="flex:1;padding:10px 0;background:#071220">
              <div style="font-size:9px;letter-spacing:1px;color:#ff5b5b;margin-bottom:2px">TOTAL</div>
              <div id="animRedTotal" style="font-size:64px;font-weight:900;color:#ff5b5b;line-height:1">0</div>
            </div>
          </div>
          <div id="remainLine" style="padding:10px;font-size:20px;font-weight:700;color:#fbbf24;background:#0e1c2c;letter-spacing:.5px"></div>
        </div>

        <div style="font-size:11px;color:#4a5a6a;margin-bottom:8px">Spacebar or wait to continue, Escape to undo</div>
        <div style="height:4px;background:#1e3040;border-radius:2px;overflow:hidden">
          <div id="autoDismissBar" style="height:100%;width:100%;background:#4aa3ff;border-radius:2px;transition:width linear"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Auto-dismiss timer (started after all animations complete)
    const AUTO_DISMISS_MS = 10000;
    let autoDismissTimer = null;
    const bar = modal.querySelector("#autoDismissBar");

    function startAutoDismiss() {
      animating = false;
      requestAnimationFrame(() => {
        bar.style.transitionDuration = AUTO_DISMISS_MS + "ms";
        bar.style.width = "0%";
      });
      autoDismissTimer = setTimeout(() => {
        dismissModal();
      }, AUTO_DISMISS_MS);
    }

    function cancelAutoDismiss() {
      if (autoDismissTimer) { clearTimeout(autoDismissTimer); autoDismissTimer = null; }
    }

    function dismissModal() {
      if (animating || dismissed) return;
      dismissed = true;
      cancelAutoDismiss();
      if (modal.parentNode) modal.remove();
      if (!undone) {
        const game = State.game;
        if (game && !game.ended && isGoalMet(game)) {
          game.ended = true;
          game.endedAt = Date.now();
          saveToHistory(game);
          clearSavedGame();
          showWinnerPopup(game);
        }
      }
    }

    function doUndo() {
      if (undone) return;
      undone = true;
      dismissed = true;
      animating = false;
      cancelAllTimers();
      cancelAutoDismiss();
      const game = State.game;
      if (game && roundNum - 1 < game.rounds.length) {
        const removed = game.rounds.splice(roundNum - 1);
        for (const r of removed) {
          game.totals.blue -= r.blue;
          game.totals.red  -= r.red;
        }
        updateScoreboard();
        saveGame();
      }
      if (modal.parentNode) modal.remove();
    }

    // Expose helpers for keyboard handler
    modal._dismiss = dismissModal;
    modal._undo = doUndo;

    // Click handler — dismiss on any click except the undo button (only after animation)
    modal.addEventListener("click", (e) => {
      if (e.target.id === "btnUndoScoreAnim") return;
      dismissModal();
    });

    // Undo button
    modal.querySelector("#btnUndoScoreAnim")?.addEventListener("click", (e) => {
      e.stopPropagation();
      doUndo();
    });

    // Element references
    const blueEquationEl  = modal.querySelector("#blueEquation");
    const blueTotalRowEl  = modal.querySelector("#blueTotalRow");
    const animBlueEl      = modal.querySelector("#animBlue");
    const redEquationEl   = modal.querySelector("#redEquation");
    const redTotalRowEl   = modal.querySelector("#redTotalRow");
    const animRedEl       = modal.querySelector("#animRed");
    const totalsBlock     = modal.querySelector("#totalsBlock");
    const animBlueTotalEl = modal.querySelector("#animBlueTotal");
    const animRedTotalEl  = modal.querySelector("#animRedTotal");
    const remainLineEl    = modal.querySelector("#remainLine");

    // Recalculate round & game totals after a questionable puck toggle
    function recalcRound() {
      const oldBlue = round.blue, oldRed = round.red;
      round.blue = round.puckScores.filter(p => p.team === "blue").reduce((s, p) => s + p.points, 0);
      round.red  = round.puckScores.filter(p => p.team === "red").reduce((s, p) => s + p.points, 0);
      if (g) {
        g.totals.blue += (round.blue - oldBlue);
        g.totals.red  += (round.red - oldRed);
      }
      animBlueEl.textContent = round.blue;
      animRedEl.textContent  = round.red;
      if (g) {
        animBlueTotalEl.textContent = g.totals.blue;
        animRedTotalEl.textContent  = g.totals.red;
      }
      updateScoreboard();
      saveGame();
    }

    // Reveal pucks one by one, then show team total
    function revealTeam(puckList, team, equationEl, totalRowEl, totalEl, callback) {
      if (undone) return;

      if (!puckList.length) {
        equationEl.innerHTML = `<span style="color:#4a5a6a">\u2014</span>`;
        totalEl.textContent = round[team];
        totalRowEl.style.opacity = "1";
        if (round[team] <= 0) playSadSound();
        scheduleTimer(callback, 400);
        return;
      }

      let idx = 0;
      function showNextPuck() {
        if (undone) return;
        if (idx >= puckList.length) {
          // All pucks shown — reveal total
          scheduleTimer(() => {
            if (undone) return;
            totalEl.textContent = round[team];
            totalRowEl.style.opacity = "1";

            // Team-level sound
            const tt = round[team];
            if (tt > 20) playHappyDingFlourish();
            else if (tt > 10) playHappyDing();
            else if (tt <= 0) playSadSound();

            scheduleTimer(callback, 500);
          }, 350);
          return;
        }

        const p = puckList[idx];

        // Operator between pucks
        if (idx > 0) {
          const op = document.createElement("span");
          op.style.cssText = "color:#4a5a6a";
          op.textContent = p.points < 0 ? "\u2212" : "+";
          equationEl.appendChild(op);
        }

        // Puck value
        const val = document.createElement("span");
        val.style.cssText = "font-weight:700;transform:scale(0);display:inline-block;transition:transform .2s ease-out";
        val.textContent = (idx > 0 && p.points < 0) ? Math.abs(p.points) : p.points;
        equationEl.appendChild(val);

        // Questionable puck — add '?' / '⎌' toggle button
        if (p.questionable) {
          const qBtn = document.createElement("button");
          qBtn.style.cssText = "background:#3a3520;border:1px solid #7a6a30;color:#fbbf24;padding:1px 5px;border-radius:5px;font-size:13px;cursor:pointer;font-family:inherit;margin-left:2px;line-height:1;vertical-align:middle";
          qBtn.textContent = "?";
          equationEl.appendChild(qBtn);

          qBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            // Cancel auto-dismiss so user can review the change
            cancelAutoDismiss();
            bar.style.transitionDuration = "0s";
            bar.style.width = "100%";
            if (qBtn.textContent === "?") {
              p.points = p.altPoints;
              val.textContent = p.altPoints;
              qBtn.textContent = "\u238C";
              qBtn.style.background = "#1a3520";
              qBtn.style.borderColor = "#2a6b4a";
              qBtn.style.color = "#36d399";
            } else {
              p.points = 0;
              val.textContent = "0";
              qBtn.textContent = "?";
              qBtn.style.background = "#3a3520";
              qBtn.style.borderColor = "#7a6a30";
              qBtn.style.color = "#fbbf24";
            }
            recalcRound();
          });
        }

        requestAnimationFrame(() => { val.style.transform = "scale(1)"; });

        playPuckSound(p.points);
        idx++;
        scheduleTimer(showNextPuck, 450);
      }

      scheduleTimer(showNextPuck, 300);
    }

    // Animate: blue pucks+total → red pucks+total → running totals
    revealTeam(bluePucks, "blue", blueEquationEl, blueTotalRowEl, animBlueEl, () => {
      revealTeam(redPucks, "red", redEquationEl, redTotalRowEl, animRedEl, () => {
        if (undone) return;
        // Phase 2: fade in running totals and count up
        scheduleTimer(() => {
          if (undone) return;
          totalsBlock.style.opacity = "1";
          animBlueTotalEl.textContent = "0";
          animRedTotalEl.textContent  = "0";
          remainLineEl.textContent    = remainStr;

          const phase2Dur   = 900;
          const phase2Start = performance.now();
          let lastTick2 = -1;

          function phase2(now2) {
            if (undone) return;
            const gbt = g ? g.totals.blue : 0;
            const grt = g ? g.totals.red  : 0;
            const t2    = Math.min(1, (now2 - phase2Start) / phase2Dur);
            const ease2 = 1 - Math.pow(1 - t2, 4);
            const curBT = Math.round(ease2 * gbt);
            const curRT = Math.round(ease2 * grt);
            animBlueTotalEl.textContent = curBT;
            animRedTotalEl.textContent  = curRT;
            // Escalating tick on each integer change
            const curMax2 = Math.max(curBT, curRT);
            if (curMax2 > lastTick2 && curMax2 > 0) {
              lastTick2 = curMax2;
              playTick(t2);
            }
            if (t2 < 1) { requestAnimationFrame(phase2); }
            else {
              animBlueTotalEl.textContent = gbt;
              animRedTotalEl.textContent  = grt;
              startAutoDismiss();
            }
          }
          requestAnimationFrame(phase2);
        }, 250);
      });
    });
  }

  function showRoundPopup(round, roundNum) {
    const img = round.screenshot
      ? `<img src="${round.screenshot}" style="width:100%;border-radius:10px;display:block;margin-bottom:14px;" />`
      : `<div style="color:#9fb0c2;margin-bottom:14px;text-align:center">No screenshot</div>`;
    const roundIdx = roundNum - 1;
    const canUndo = State.game && !State.game.ended && roundIdx < State.game.rounds.length;
    const modal = makeModal(`
      <div style="
        background:#121a22;border:1px solid #223140;border-radius:18px;
        padding:24px;max-width:640px;width:100%;font-family:-apple-system,system-ui,sans-serif;color:#e7eef7;
      ">
        <div style="font-size:13px;color:#9fb0c2;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px">Round ${roundNum}</div>
        ${img}
        <div style="display:flex;gap:24px;justify-content:center;margin-bottom:12px">
          <div style="text-align:center">
            <div style="font-size:11px;color:#4aa3ff">BLUE</div>
            <div style="font-size:36px;font-weight:800;color:#4aa3ff">${round.blue}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:11px;color:#ff5b5b">RED</div>
            <div style="font-size:36px;font-weight:800;color:#ff5b5b">${round.red}</div>
          </div>
        </div>
        ${canUndo ? `<div style="text-align:center;margin-bottom:12px">
          <button id="btnUndoRoundPopup" style="
            background:#401a1a;border:1px solid #6a2b2b;color:#ffd2d8;
            padding:10px 28px;border-radius:10px;font-size:14px;cursor:pointer;font-family:inherit;
          ">Undo Round</button>
        </div>` : ""}
        <div style="font-size:11px;color:#4a5a6a;text-align:center">Tap outside to close</div>
      </div>
    `);

    if (canUndo) {
      modal.querySelector("#btnUndoRoundPopup")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const g = State.game;
        if (!g || roundIdx >= g.rounds.length) return;
        // Remove this round and all rounds after it, adjusting totals
        const removed = g.rounds.splice(roundIdx);
        for (const r of removed) {
          g.totals.blue -= r.blue;
          g.totals.red  -= r.red;
        }
        updateScoreboard();
        modal.remove();
      });
    }
  }

  function showWinnerPopup(game) {
    const winner = game.totals.blue > game.totals.red ? "blue"
                 : game.totals.red  > game.totals.blue ? "red"
                 : "tie";
    const winColor  = winner === "blue" ? "#4aa3ff" : winner === "red" ? "#ff5b5b" : "#fbbf24";
    const winLabel  = winner === "tie"  ? "It's a Tie! 🤝" : (winner.toUpperCase() + " WINS! 🎉");

    // Full-screen confetti in the winning team's color
    const confettiColors = winner === "blue" ? ["#4aa3ff","#2b7de9","#80c4ff","#1d5fb8"]
                         : winner === "red"  ? ["#ff5b5b","#e93b3b","#ff9090","#c42020"]
                         : ["#fbbf24","#f59e0b","#fde68a","#d97706"];
    let confettiHtml = "";
    for (let i = 0; i < 60; i++) {
      const c = confettiColors[i % confettiColors.length];
      const left = Math.random() * 100;
      const delay = Math.random() * 1.5;
      const dur = 2 + Math.random() * 2;
      const size = 6 + Math.random() * 8;
      const drift = -30 + Math.random() * 60;
      const rot = Math.random() * 720;
      confettiHtml += `<div style="
        position:absolute;left:${left}%;top:-20px;width:${size}px;height:${size * 0.6}px;
        background:${c};border-radius:1px;opacity:0.9;
        animation:confettiFall ${dur}s ${delay}s ease-in forwards;
        --drift:${drift}px;--rot:${rot}deg;
      "></div>`;
    }

    // Play celebratory sound
    playWinFanfare();

    const rows = game.rounds.map((r,i) => {
      const thumb = r.screenshot
        ? `<img src="${r.screenshot}" onclick="document.getElementById('bigShot').src=this.src;document.getElementById('bigShotWrap').style.display='flex'"
             style="width:48px;height:32px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid #223140" />`
        : `<span style="color:#9fb0c2;font-size:11px">—</span>`;
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #1a2535">${i+1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #1a2535;color:#4aa3ff;font-weight:700">${r.blue}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #1a2535;color:#ff5b5b;font-weight:700">${r.red}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #1a2535">${thumb}</td>
      </tr>`;
    }).join("");

    const winModal = makeModal(`
      <div style="
        background:#0b0f14;border:1px solid #223140;border-radius:20px;
        padding:32px;max-width:520px;width:100%;font-family:-apple-system,system-ui,sans-serif;
        color:#e7eef7;position:relative;overflow:hidden;max-height:90vh;overflow-y:auto;
      ">
        <style>
          @keyframes confettiFall {
            0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; }
            100% { transform: translateY(100vh) translateX(var(--drift)) rotate(var(--rot)); opacity: 0; }
          }
        </style>
        <div style="position:absolute;inset:0;pointer-events:none;overflow:hidden">${confettiHtml}</div>
        <div style="font-size:32px;font-weight:900;color:${winColor};text-align:center;margin-bottom:4px">${winLabel}</div>
        <div style="text-align:center;margin-bottom:24px">
          <span style="font-size:48px;font-weight:800;color:#4aa3ff">${game.totals.blue}</span>
          <span style="font-size:24px;color:#9fb0c2;margin:0 12px">—</span>
          <span style="font-size:48px;font-weight:800;color:#ff5b5b">${game.totals.red}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px 8px;color:#9fb0c2;font-weight:600">#</th>
              <th style="text-align:left;padding:6px 8px;color:#4aa3ff;font-weight:600">Blue</th>
              <th style="text-align:left;padding:6px 8px;color:#ff5b5b;font-weight:600">Red</th>
              <th style="text-align:left;padding:6px 8px;color:#9fb0c2;font-weight:600">Shot</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <!-- inline screenshot viewer -->
        <div id="bigShotWrap" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:2000;align-items:center;justify-content:center;padding:16px"
             onclick="this.style.display='none'">
          <img id="bigShot" style="max-width:100%;max-height:90vh;border-radius:10px" />
        </div>
        <div style="text-align:center;display:flex;gap:12px;justify-content:center">
          <button id="btnNewGameFromWinner" style="
            background:#234a22;border:1px solid #36d399;color:#baf7dd;
            padding:10px 28px;border-radius:10px;font-size:15px;cursor:pointer
          ">New Game</button>
        </div>
        <div style="font-size:11px;color:#4a5a6a;text-align:center;margin-top:12px">Tap outside to close</div>
      </div>
    `);
    winModal.dataset.popupType = "winner";

    // Full-screen confetti overlay (behind modal content, in front of app)
    const confettiOverlay = document.createElement("div");
    Object.assign(confettiOverlay.style, {
      position:"fixed", inset:"0", zIndex:"999", pointerEvents:"none", overflow:"hidden",
    });
    // Add the keyframe style for the overlay too
    const styleEl = document.createElement("style");
    styleEl.textContent = `@keyframes confettiFall{0%{transform:translateY(0) translateX(0) rotate(0deg);opacity:1}100%{transform:translateY(100vh) translateX(var(--drift)) rotate(var(--rot));opacity:0}}`;
    confettiOverlay.appendChild(styleEl);
    confettiOverlay.innerHTML += confettiHtml;
    document.body.appendChild(confettiOverlay);

    winModal.querySelector("#btnNewGameFromWinner")?.addEventListener("click", () => {
      winModal.remove();
      confettiOverlay.remove();
      State.game = null;
      State.mode = "game_setup";
      updateScoreboard();
      render();
    });

    // Also remove confetti when modal is dismissed by clicking outside
    winModal.addEventListener("click", (e) => {
      if (e.target === winModal) confettiOverlay.remove();
    });
  }

  function showHistoryPopup() {
    const hist = loadHistory();
    if (!hist.length) {
      makeModal(`<div style="background:#121a22;border:1px solid #223140;border-radius:18px;padding:32px;color:#e7eef7;font-family:-apple-system,system-ui,sans-serif;text-align:center;min-width:240px">
        <div style="color:#9fb0c2;margin-bottom:8px">No completed games yet.</div>
        <div style="font-size:11px;color:#4a5a6a">Tap outside to close</div>
      </div>`);
      return;
    }

    const rows = hist.map((g, i) => {
      const d = new Date(g.startedAt);
      const dateStr = d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
      const winner = g.totals.blue > g.totals.red ? "🔵 Blue" : g.totals.red > g.totals.blue ? "🔴 Red" : "Tie";
      return `<tr style="cursor:pointer" data-idx="${i}" class="hist-row">
        <td style="padding:10px 12px;border-bottom:1px solid #1a2535;color:#9fb0c2;font-size:12px;white-space:nowrap">${dateStr}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #1a2535;font-weight:700">${winner}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #1a2535;color:#4aa3ff;font-weight:700">${g.totals.blue}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #1a2535;color:#ff5b5b;font-weight:700">${g.totals.red}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #1a2535;color:#9fb0c2;font-size:12px">${g.rounds.length} rnds</td>
      </tr>`;
    }).join("");

    const modal = makeModal(`
      <div style="background:#0b0f14;border:1px solid #223140;border-radius:18px;padding:24px;
        max-width:560px;width:100%;font-family:-apple-system,system-ui,sans-serif;color:#e7eef7;max-height:85vh;overflow-y:auto">
        <div style="font-size:16px;font-weight:700;margin-bottom:16px">Game History</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="color:#9fb0c2;font-size:11px;text-transform:uppercase;letter-spacing:.5px">
              <th style="text-align:left;padding:6px 12px">Date</th>
              <th style="text-align:left;padding:6px 12px">Winner</th>
              <th style="padding:6px 12px;color:#4aa3ff">Blue</th>
              <th style="padding:6px 12px;color:#ff5b5b">Red</th>
              <th style="padding:6px 12px">Rnds</th>
            </tr>
          </thead>
          <tbody id="histBody">${rows}</tbody>
        </table>
        <div style="text-align:center;margin-top:16px">
          <button id="btnClearHistory" style="
            background:#401a1a;border:1px solid #6a2b2b;color:#ffd2d8;
            padding:8px 20px;border-radius:10px;font-size:13px;cursor:pointer;font-family:inherit;
          ">Clear History</button>
        </div>
        <div style="font-size:11px;color:#4a5a6a;text-align:center;margin-top:10px">Tap outside to close · Tap a row for details</div>
      </div>
    `);

    modal.querySelector("#btnClearHistory")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm("Clear all game history?")) return;
      localStorage.removeItem(LS_HISTORY_KEY);
      modal.remove();
    });

    modal.querySelectorAll(".hist-row").forEach(row => {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        modal.remove();
        showWinnerPopup(hist[Number(row.dataset.idx)]);
      });
    });
  }

  // ========== OVERLAY DRAWING ==========
  function getLiveDetections() {
    const now = performance.now();
    const interval = 300;
    if (now - State.detectCache.ts < interval) return State.detectCache;
    
    const pucks = detectPucks();
    let scored = null;
    if (State.mode !== "calibrate_triangle") {
      scored = scoreRound(pucks);
    }
    
    // Update hint with detection stats
    if (State.mode === "calibrate_colors" && pucks._debug) {
      const d = pucks._debug;
      hintText.textContent = `Found: ${d.redBlobs} red blobs → ${d.redPucks} pucks | ${d.blueBlobs} blue blobs → ${d.bluePucks} pucks`;
    }
    
    State.detectCache = { ts: now, pucks, scored };
    return State.detectCache;
  }
  
  const scale = (p) => ({ x: p.x * devicePixelRatio, y: p.y * devicePixelRatio });
  const unscale = (p) => ({ x: p.x / devicePixelRatio, y: p.y / devicePixelRatio });
  
  function drawOverlay() {
    const W = overlay.width, H = overlay.height;
    ctx.clearRect(0,0,W,H);

    // When using a test image, draw it as the background since the video element is hidden
    if (State.testImage) {
      const vr = getVideoRect();
      ctx.drawImage(State.testImage, vr.x, vr.y, vr.w, vr.h);
    }

    // Letterbox bars: fill areas outside the video content with opaque black
    // so the user can't accidentally place calibration handles there.
    const vr = getVideoRect();
    ctx.save();
    ctx.fillStyle = "#000";
    if (vr.y > 0)          ctx.fillRect(0,    0,    W,    vr.y);
    if (vr.y+vr.h < H)     ctx.fillRect(0,    vr.y+vr.h, W, H-(vr.y+vr.h));
    if (vr.x > 0)          ctx.fillRect(0,    vr.y,  vr.x,   vr.h);
    if (vr.x+vr.w < W)     ctx.fillRect(vr.x+vr.w, vr.y, W-(vr.x+vr.w), vr.h);
    ctx.restore();

    // Subtle darkening over the video area for readability
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = "#000";
    ctx.fillRect(vr.x, vr.y, vr.w, vr.h);
    ctx.restore();
    
    const cfg = State.config;
    const t = cfg.lineThickness * devicePixelRatio;
    const r = cfg.puckRadius * devicePixelRatio;
    
    // Draw triangle
    const A = scale(cfg.tri.A), B = scale(cfg.tri.B), C = scale(cfg.tri.C);
    ctx.lineWidth = t;
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.lineTo(C.x, C.y);
    ctx.closePath();
    ctx.stroke();
    
    // Draw boundary lines
    if (State.mode !== "calibrate_triangle") {
      ctx.strokeStyle = "rgba(54,211,153,0.8)";
      cfg.lines.forEach(L => {
        const p1 = scale(L.p1), p2 = scale(L.p2);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      });
    }
    
    // Draw handles during calibration
    if (State.mode.startsWith("calibrate")) {
      function drawHandle(p, label, color) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 2*devicePixelRatio;
        const rad = 8 * devicePixelRatio;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = `${10*devicePixelRatio}px system-ui`;
        ctx.fillText(label, p.x + rad + 3*devicePixelRatio, p.y + 3*devicePixelRatio);
        ctx.restore();
      }
      
      drawHandle(A, "A", "rgba(251,191,36,0.9)");
      drawHandle(B, "B", "rgba(251,191,36,0.9)");
      drawHandle(C, "C (tip)", "rgba(251,191,36,0.9)");
      
      if (State.mode !== "calibrate_triangle") {
        cfg.lines.forEach((L, idx) => {
          drawHandle(scale(L.p1), `${idx+1}a`, "rgba(54,211,153,0.9)");
          drawHandle(scale(L.p2), `${idx+1}b`, "rgba(54,211,153,0.9)");
        });
      }
      
      if (State.mode === "calibrate_colors") {
        // Draw draggable distortion centre crosshair
        const cW2 = overlay.width  / devicePixelRatio;
        const cH2 = overlay.height / devicePixelRatio;
        const d2   = State.config.distortion;
        const dcx  = ((d2 && d2.cx != null) ? d2.cx : cW2 / 2) * devicePixelRatio;
        const dcy  = ((d2 && d2.cy != null) ? d2.cy : cH2 / 2) * devicePixelRatio;
        const arm  = 14 * devicePixelRatio;
        const cr   = 7  * devicePixelRatio;
        ctx.save();
        // Crosshair arms
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth   = 2.5 * devicePixelRatio;
        ctx.beginPath();
        ctx.moveTo(dcx - arm, dcy); ctx.lineTo(dcx + arm, dcy);
        ctx.moveTo(dcx, dcy - arm); ctx.lineTo(dcx, dcy + arm);
        ctx.stroke();
        // Circle
        ctx.strokeStyle = "rgba(251,191,36,0.95)";
        ctx.fillStyle   = "rgba(251,191,36,0.18)";
        ctx.lineWidth   = 2 * devicePixelRatio;
        ctx.beginPath();
        ctx.arc(dcx, dcy, cr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Label
        ctx.fillStyle = "rgba(251,191,36,0.95)";
        ctx.font = `${10 * devicePixelRatio}px system-ui`;
        ctx.fillText("distortion centre", dcx + cr + 4 * devicePixelRatio, dcy + 4 * devicePixelRatio);
        ctx.restore();

        // Show 5 ghost circles: one at centre, one near each corner.
        // Each circle is drawn at the CORRECTED position with the EFFECTIVE radius
        // so the user can see both distortion parameters working together.
        // An arrow from the raw position to the corrected position shows the pull-in.
        const rawPoints = [
          { x: W * 0.5,  y: H * 0.5  },   // centre
          { x: W * 0.15, y: H * 0.15 },   // top-left
          { x: W * 0.85, y: H * 0.15 },   // top-right
          { x: W * 0.15, y: H * 0.85 },   // bottom-left
          { x: W * 0.85, y: H * 0.85 },   // bottom-right
        ];

        for (const pt of rawPoints) {
          const cssRawX = pt.x / devicePixelRatio;
          const cssRawY = pt.y / devicePixelRatio;
          const corrected = correctPuckPosition(cssRawX, cssRawY);
          const corrX = corrected.x * devicePixelRatio;
          const corrY = corrected.y * devicePixelRatio;
          const effR  = effectivePuckRadius(cssRawX, cssRawY) * devicePixelRatio;

          // Draw corrected-position circle
          ctx.save();
          ctx.strokeStyle = "rgba(74,163,255,0.6)";
          ctx.lineWidth = 2 * devicePixelRatio;
          ctx.setLineDash([5*devicePixelRatio, 5*devicePixelRatio]);
          ctx.beginPath();
          ctx.arc(corrX, corrY, effR, 0, Math.PI * 2);
          ctx.stroke();

          // Draw small dot at raw position and line to corrected position
          if (corrX !== pt.x || corrY !== pt.y) {
            ctx.setLineDash([]);
            ctx.strokeStyle = "rgba(251,191,36,0.7)";
            ctx.lineWidth = 1.5 * devicePixelRatio;
            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y);
            ctx.lineTo(corrX, corrY);
            ctx.stroke();
            ctx.fillStyle = "rgba(251,191,36,0.9)";
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3 * devicePixelRatio, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }
    
    // Draw detected pucks
    const live = getLiveDetections();
    if (live && live.pucks && live.pucks.length > 0) {
      const byKey = new Map();
      if (live.scored && live.scored.results) {
        for (const r of live.scored.results) {
          byKey.set(`${Math.round(r.x)}:${Math.round(r.y)}:${r.team}`, r);
        }
      }
      
      for (const p of live.pucks) {
        const key = `${Math.round(p.x)}:${Math.round(p.y)}:${p.team}`;
        const scored = byKey.get(key);
        const points = scored ? scored.points : 0;
        const valid  = scored ? scored.valid  : true;

        const col = p.team === "blue" ? "rgba(74,163,255,0.5)" : "rgba(255,91,91,0.5)";

        // Use the same effective radius the collision check used so the
        // drawn circle is always honest about what was tested.
        const effR = (scored && scored.effR != null)
          ? scored.effR * devicePixelRatio
          : effectivePuckRadius(p.x, p.y) * devicePixelRatio;

        const cx = p.x * devicePixelRatio;
        const cy = p.y * devicePixelRatio;

        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2*devicePixelRatio;
        ctx.beginPath();
        ctx.arc(cx, cy, effR, 0, Math.PI*2);
        ctx.stroke();

        // Centered label inside the puck
        const label = (scored ? `${points}` : p.team.toUpperCase());
        const fontSize = Math.max(14, Math.min(22, effR * 1.05 / devicePixelRatio));
        ctx.font = `bold ${fontSize*devicePixelRatio}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const m = ctx.measureText(label);
        const pad = 1 * devicePixelRatio;
        const bgW = m.width + pad * 2;
        const bgH = fontSize * devicePixelRatio + pad * 2;
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.beginPath();
        ctx.roundRect(cx - bgW/2, cy - bgH/2, bgW, bgH, 4*devicePixelRatio);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, cx, cy);
        ctx.restore();
      }
    }
  }
  
  // ========== POINTER INTERACTION ==========
  function getPointerPos(evt) {
    const rect = overlay.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left) * devicePixelRatio,
      y: (evt.clientY - rect.top) * devicePixelRatio
    };
  }
  
  function hitTestHandles(pos) {
    const cfg = State.config;
    const handles = [];
    
    handles.push({ type:"tri", key:"A", p: scale(cfg.tri.A) });
    handles.push({ type:"tri", key:"B", p: scale(cfg.tri.B) });
    handles.push({ type:"tri", key:"C", p: scale(cfg.tri.C) });
    
    if (State.mode !== "calibrate_triangle") {
      cfg.lines.forEach((L, idx) => {
        handles.push({ type:"line", idx, end:"p1", p: scale(L.p1) });
        handles.push({ type:"line", idx, end:"p2", p: scale(L.p2) });
      });
    }

    // Distortion centre handle — only visible in calibrate_colors
    if (State.mode === "calibrate_colors") {
      const cW = overlay.width  / devicePixelRatio;
      const cH = overlay.height / devicePixelRatio;
      const d  = cfg.distortion;
      const dcx = (d && d.cx != null) ? d.cx : cW / 2;
      const dcy = (d && d.cy != null) ? d.cy : cH / 2;
      handles.push({ type:"distCenter", p: scale({ x: dcx, y: dcy }) });
    }
    
    const R = 12 * devicePixelRatio;
    for (const h of handles) {
      if (Math.hypot(pos.x - h.p.x, pos.y - h.p.y) <= R) return h;
    }
    return null;
  }
  
  overlay.addEventListener("pointerdown", (evt) => {
    overlay.setPointerCapture(evt.pointerId);
    const pos = getPointerPos(evt);
    
    // Color sampling
    if (State.drag && State.drag.type === "sample") {
      sampleColorAt(pos, State.drag.team);
      State.drag = null;
      return;
    }
    
    if (!State.mode.startsWith("calibrate")) return;
    const hit = hitTestHandles(pos);
    if (hit) {
      State.drag = { ...hit, offset: { dx: pos.x - hit.p.x, dy: pos.y - hit.p.y } };
    }
  });
  
  overlay.addEventListener("pointermove", (evt) => {
    if (!State.drag || State.drag.type === "sample") return;
    if (!State.mode.startsWith("calibrate")) return;
    
    const pos = getPointerPos(evt);
    const p = { x: pos.x - State.drag.offset.dx, y: pos.y - State.drag.offset.dy };
    const u = unscale(p);
    
    if (State.drag.type === "tri") {
      State.config.tri[State.drag.key] = { x: u.x, y: u.y };
      saveConfig();
    } else if (State.drag.type === "line") {
      State.config.lines[State.drag.idx][State.drag.end] = { x: u.x, y: u.y };
      saveConfig();
    } else if (State.drag.type === "distCenter") {
      if (!State.config.distortion) State.config.distortion = { k: 0, p: 0, cx: null, cy: null };
      State.config.distortion.cx = u.x;
      State.config.distortion.cy = u.y;
      saveConfig();
    }
  });
  
  overlay.addEventListener("pointerup", () => {
    if (State.drag && State.drag.type !== "sample") {
      State.drag = null;
    }
  });
  
  // ========== COLOR SAMPLING ==========
  function sampleColorAt(pos, team) {
    const W = overlay.width, H = overlay.height;
    // Use the same letterbox draw as detection so sampled pixel coords match
    const vr = getVideoRect();
    wctx.clearRect(0, 0, W, H);
    wctx.drawImage(getSource(), vr.x, vr.y, vr.w, vr.h);

    // Sample 5x5 area to get better average
    let hSum = 0, sSum = 0, vSum = 0, count = 0;
    
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.round(clamp(pos.x + dx, 0, W-1));
        const y = Math.round(clamp(pos.y + dy, 0, H-1));
        const px = wctx.getImageData(x, y, 1, 1).data;
        const hsv = rgbToHsv(px[0], px[1], px[2]);
        hSum += hsv.h;
        sSum += hsv.s;
        vSum += hsv.v;
        count++;
      }
    }
    
    const h = hSum / count;
    const s = sSum / count;
    const v = vSum / count;
    
    const target = State.config[team];
    target.hueCenter = Math.round(h);
    target.hueRange = 25; // Default generous range
    target.satMin = Math.max(0.2, s * 0.7);  // Be lenient
    target.valMin = Math.max(0.15, v * 0.7); // Be lenient
    
    saveConfig();
    hintText.textContent = `Sampled ${team.toUpperCase()}: H=${Math.round(h)}° S=${s.toFixed(2)} V=${v.toFixed(2)}`;
  }
  
  // ========== MAIN LOOP ==========
  function render() {
    panel.innerHTML = renderPanel();
    wirePanelEvents();

    const calibrating = State.mode.startsWith("calibrate");
    const scoreHeader = $(".scoreHeader");
    const roundsSection = $(".rounds");
    if (scoreHeader) scoreHeader.style.display = calibrating ? "none" : "";
    if (roundsSection) roundsSection.style.display = calibrating ? "none" : "";

    if (State.mode === "init") setStatus("Starting...", "warn");
    else if (calibrating) setStatus("Calibrating", "warn");
    else if (State.mode === "ready") setStatus("Ready", "ok");
    else if (State.mode === "game" || State.mode === "game_setup") setStatus("Game", "ok");
  }
  
  function loop() {
    const rect = overlay.getBoundingClientRect();
    const needW = Math.round(rect.width * devicePixelRatio);
    const needH = Math.round(rect.height * devicePixelRatio);
    if (overlay.width !== needW || overlay.height !== needH) {
      resizeCanvases();
    }
    
    drawOverlay();
    requestAnimationFrame(loop);
  }
  
  function boot() {
    State.config = loadConfig();
    const raw = localStorage.getItem(LS_KEY);
    State.mode = raw ? "ready" : "calibrate_triangle";

    const savedGame = loadGame();
    if (savedGame && !savedGame.ended && raw) {
      State.game = savedGame;
      State.mode = "game";
    }

    render();
    updateScoreboard();
    startCamera();
  }
  
  boot();
})();
