// Garage Shuffleboard Scorer (MVP)
// Runs entirely in-browser (Safari iPad). No backend.
// Notes on iPad camera security:
// - getUserMedia requires a secure context (HTTPS) or localhost.
// - See README at bottom of this file for a quick local-HTTPS method.

(() => {
  const BUILD = "v5";

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
  document.title = `Garage Shuffleboard Scorer ${BUILD}`;

  const LS_KEY = "shuffleboard_mvp_v1";

  const State = {
    mode: "init", // init | calibrate_triangle | calibrate_lines | calibrate_pucks | ready | game_setup | game
    drag: null,
    lastFrame: null,
    config: null,
    game: null,
    detectionPreview: { enabled: true },
    detectCache: { ts: 0, pucks: [], scored: null },
  };

  // ---------- Default config ----------
  function defaultConfig() {
    return {
      detectorMode: "sticker", // sticker | color
      lineThickness: 1, // px in overlay / video coordinate space
      puckRadius: 18,    // px (set in calibration)
      puckRadiusTolerance: 0.25, // +/- 35% area/size acceptance
      touchEpsilon: 1.0, // px additional tolerance for "touching a line"

      // Geometry in video coordinate space (filled during calibration)
      tri: { // vertices in screen/video coordinates
        A: { x: 120, y: 120 },
        B: { x: 120, y: 480 },
        C: { x: 520, y: 300 }, // tip (usually right-most)
      },
      // Three boundary lines separating 10|8, 8|7, 7|-10
      // Each line is a segment with endpoints in video coords
      lines: [
        // Default: vertical dividers (you'll drag to match the painted lines)
        { p1: { x: 430, y: 210 }, p2: { x: 430, y: 390 } }, // 10 | 8
        { p1: { x: 330, y: 210 }, p2: { x: 330, y: 420 } }, // 8 | 7
        { p1: { x: 230, y: 210 }, p2: { x: 230, y: 450 } }, // 7 | -10
      ],
      // Color thresholds (HSV-ish) for red/blue
      // Hue in [0,360), S and V in [0,1]
      colors: {
        red: { h: 0, s: 0.55, v: 0.35, hTol: 22 },  // legacy color mode
        blue:{ h: 210, s: 0.50, v: 0.30, hTol: 25 },
        sMin: 0.45,
        vMin: 0.18,
      },
      stickers: {
        // Black sticker on BLUE pucks, white sticker on RED pucks
        blackThresh: 95,    // Increased from 60 - more realistic for dark stickers
        whiteThresh: 165,   // Decreased from 200 - more realistic for light stickers
        minArea: 50,        // Decreased from 80 - allow smaller detections
        maxArea: 8000,      // Increased from 6000 - allow larger detections
        aspectMin: 0.5,     // More lenient from 0.6
        aspectMax: 2.0,     // More lenient from 1.7
      }
    };
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultConfig();
      const parsed = JSON.parse(raw);
      return { ...defaultConfig(), ...parsed };
    } catch {
      return defaultConfig();
    }
  }
  function saveConfig() {
    localStorage.setItem(LS_KEY, JSON.stringify(State.config));
  }

  function setStatus(text, kind="") {
    statusPill.textContent = text;
    statusPill.className = "status";
    if (kind === "ok") statusPill.classList.add("pill","ok");
    else if (kind === "warn") statusPill.classList.add("pill","warn");
    else if (kind === "bad") statusPill.classList.add("pill","bad");
  }

  // ---------- Camera ----------
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
      requestAnimationFrame(loop);
    } catch (err) {
      console.error(err);
      setStatus("Camera blocked (needs HTTPS)", "bad");
      panel.innerHTML = renderCameraHelp(err);
    }
  }

  function resizeCanvases() {
    // Match canvas backing store to video element size on screen
    const rect = overlay.getBoundingClientRect();
    overlay.width = Math.round(rect.width * devicePixelRatio);
    overlay.height = Math.round(rect.height * devicePixelRatio);
    work.width = overlay.width;
    work.height = overlay.height;
  }
  window.addEventListener("resize", () => {
    resizeCanvases();
  });

  // ---------- Geometry helpers ----------
  const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);

  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  function pointInTri(p, A, B, C) {
    // barycentric sign method
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
    const proj = { x: a.x + t*vx, y: a.y + t*vy };
    return Math.hypot(p.x - proj.x, p.y - proj.y);
  }

  function whichSide(p, a, b) {
    // returns signed area / cross sign (b-a) x (p-a)
    return (b.x - a.x)*(p.y - a.y) - (b.y - a.y)*(p.x - a.x);
  }

  function ensureTipIsC() {
    // Make C the right-most vertex (tip) for consistent scoring direction.
    const { A, B, C } = State.config.tri;
    const verts = [
      { k:"A", ...A },
      { k:"B", ...B },
      { k:"C", ...C },
    ].sort((u,v) => v.x - u.x);
    const tip = verts[0];
    // If tip already C, nothing.
    if (tip.k === "C") return;
    // Rotate keys so that tip becomes C, and keep the other two as A/B (order doesn't matter for triangle edge checks).
    const other = verts.slice(1);
    State.config.tri = {
      A: { x: other[0].x, y: other[0].y },
      B: { x: other[1].x, y: other[1].y },
      C: { x: tip.x, y: tip.y },
    };
  }

  // ---------- HSV + color classification ----------
  // Returns {h in [0,360), s in [0,1], v in [0,1]}
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

  function hueDist(a,b){
    const d = Math.abs(a-b) % 360;
    return Math.min(d, 360-d);
  }

  function isColor(hsv, target){
    const { sMin, vMin } = State.config.colors;
    if (hsv.s < sMin || hsv.v < vMin) return false;
    return hueDist(hsv.h, target.h) <= target.hTol && hsv.s >= target.s && hsv.v >= target.v;
  }

  // ---------- Simple connected-component blob detection ----------
  // Works on a small processing size and returns centers in overlay coordinates.
  function detectPucksSnapshot(opts = {}) {
    const W = overlay.width;
    const H = overlay.height;

    // Draw current video frame into work canvas (same size as overlay)
    wctx.drawImage(video, 0, 0, W, H);

    // Downscale for processing speed (reduced from /2 to /1.5 for better sticker detection)
    const procW = Math.round(W / 1.5);
    const procH = Math.round(H / 1.5);

    // Draw scaled frame into temp canvas for pixel access
    const tmp = detectPucksSnapshot._tmp || (detectPucksSnapshot._tmp = document.createElement("canvas"));
    tmp.width = procW; tmp.height = procH;
    const tctx = detectPucksSnapshot._tctx || (detectPucksSnapshot._tctx = tmp.getContext("2d", { willReadFrequently: true }));
    tctx.drawImage(work, 0, 0, procW, procH);

    const img = tctx.getImageData(0,0,procW,procH);
    const data = img.data;

    // ROI restriction
    const useROI = opts.roi !== false && State.config?.tri;
    let At, Bt, Ct;
    if (useROI) {
      ensureTipIsC();
      const A = scale(State.config.tri.A), B = scale(State.config.tri.B), C = scale(State.config.tri.C);
      const sx = procW / (W/devicePixelRatio);
      const sy = procH / (H/devicePixelRatio);
      At = { x: (A.x / devicePixelRatio) * sx, y: (A.y / devicePixelRatio) * sy };
      Bt = { x: (B.x / devicePixelRatio) * sx, y: (B.y / devicePixelRatio) * sy };
      Ct = { x: (C.x / devicePixelRatio) * sx, y: (C.y / devicePixelRatio) * sy };
    }

    // Morphology helpers (3x3)
    function erode(src, w, h, minNeighbors){
      const dst = new Uint8Array(src.length);
      for (let y=1; y<h-1; y++){
        for (let x=1; x<w-1; x++){
          const i = y*w + x;
          if (!src[i]) continue;
          let n=0;
          for (let yy=-1; yy<=1; yy++){
            const row = (y+yy)*w;
            for (let xx=-1; xx<=1; xx++){
              n += src[row + (x+xx)] ? 1 : 0;
            }
          }
          if (n >= minNeighbors) dst[i]=1;
        }
      }
      return dst;
    }
    function dilate(src, w, h, minNeighbors){
      const dst = new Uint8Array(src.length);
      for (let y=1; y<h-1; y++){
        for (let x=1; x<w-1; x++){
          const i = y*w + x;
          let n=0;
          for (let yy=-1; yy<=1; yy++){
            const row = (y+yy)*w;
            for (let xx=-1; xx<=1; xx++){
              n += src[row + (x+xx)] ? 1 : 0;
            }
          }
          if (n >= minNeighbors) dst[i]=1;
        }
      }
      return dst;
    }
    function clean(mask){
      // Gentler morphology to preserve small sticker detections
      // Old: erode(5), dilate(3), dilate(3), erode(4) - too aggressive
      // New: erode(4), dilate(2), dilate(2), erode(3) - gentler
      const m1 = erode(mask, procW, procH, 4);  // Reduced from 5
      const m2 = dilate(m1, procW, procH, 2);   // Reduced from 3
      const m3 = dilate(m2, procW, procH, 2);   // Reduced from 3
      return erode(m3, procW, procH, 3);        // Reduced from 4
    }

    // Blob extraction via flood fill
    function extractBlobs(mask){
      const visited = new Uint8Array(mask.length);
      const blobs = [];
      const stack = [];
      for (let i=0; i<mask.length; i++){
        if (!mask[i] || visited[i]) continue;
        visited[i]=1;
        stack.length=0;
        stack.push(i);

        let area=0, sumx=0, sumy=0, minx=1e9, miny=1e9, maxx=-1e9, maxy=-1e9;
        while (stack.length){
          const idx = stack.pop();
          const x = idx % procW;
          const y = (idx / procW) | 0;
          area++;
          sumx += x; sumy += y;
          if (x<minx) minx=x;
          if (y<miny) miny=y;
          if (x>maxx) maxx=x;
          if (y>maxy) maxy=y;

          const up = idx - procW;
          const dn = idx + procW;
          const lf = idx - 1;
          const rt = idx + 1;

          if (y>0 && mask[up] && !visited[up]){ visited[up]=1; stack.push(up); }
          if (y<procH-1 && mask[dn] && !visited[dn]){ visited[dn]=1; stack.push(dn); }
          if (x>0 && mask[lf] && !visited[lf]){ visited[lf]=1; stack.push(lf); }
          if (x<procW-1 && mask[rt] && !visited[rt]){ visited[rt]=1; stack.push(rt); }
        }

        const cx = sumx/area;
        const cy = sumy/area;
        const radius = Math.sqrt(area / Math.PI);
        const w = (maxx-minx+1), h = (maxy-miny+1);
        blobs.push({ area, cx, cy, radius, bbox:{minx,miny,maxx,maxy,w,h} });
      }
      return blobs;
    }

    const scaleX = W / procW;
    const scaleY = H / procH;

    // --- Mode A: Sticker detection (recommended) ---
    if (State.config.detectorMode === "sticker") {
      const st = State.config.stickers;

      const maskBlack = new Uint8Array(procW*procH);
      const maskWhite = new Uint8Array(procW*procH);

      for (let y=0; y<procH; y++){
        for (let x=0; x<procW; x++){
          const idx = y*procW + x;
          const p = idx*4;
          const r = data[p], g = data[p+1], b = data[p+2];

          if (useROI) {
            const pt = { x, y };
            if (!pointInTri(pt, At, Bt, Ct)) continue;
          }

          const gray = (0.2126*r + 0.7152*g + 0.0722*b);
          if (gray <= st.blackThresh) maskBlack[idx]=1;
          if (gray >= st.whiteThresh) maskWhite[idx]=1;
        }
      }

      const cleanBlack = clean(maskBlack);
      const cleanWhite = clean(maskWhite);

      const blobsBlack = extractBlobs(cleanBlack);
      const blobsWhite = extractBlobs(cleanWhite);

      function filter(blobs, team){
        const out = [];
        const debug = { total: blobs.length, filtered: [] };
        
        for (const b of blobs){
          let reason = null;
          if (b.area < st.minArea) reason = `area too small (${b.area} < ${st.minArea})`;
          else if (b.area > st.maxArea) reason = `area too large (${b.area} > ${st.maxArea})`;
          else {
            const ar = b.bbox.w / b.bbox.h;
            if (ar < st.aspectMin) reason = `aspect too narrow (${ar.toFixed(2)} < ${st.aspectMin})`;
            else if (ar > st.aspectMax) reason = `aspect too wide (${ar.toFixed(2)} > ${st.aspectMax})`;
            else if (Math.min(b.bbox.w, b.bbox.h) < 4) reason = `bbox too small (${Math.min(b.bbox.w, b.bbox.h)} < 4)`;
          }
          
          if (reason) {
            debug.filtered.push({ ...b, reason });
          } else {
            out.push({
              team,
              x: b.cx * scaleX,
              y: b.cy * scaleY,
              radius: State.config.puckRadius,
              _area: b.area
            });
          }
        }
        out.sort((a,b)=>b._area-a._area);
        const result = out.slice(0, 8);
        result._debug = debug;
        return result;
      }

      // Black sticker => BLUE puck. White sticker => RED puck.
      const blue = filter(blobsBlack, "blue");
      const red  = filter(blobsWhite, "red");
      
      // Store debug info for display
      const allPucks = [...blue, ...red];
      allPucks._debugInfo = {
        blackBlobs: blobsBlack.length,
        whiteBlobs: blobsWhite.length,
        blueFiltered: blue._debug,
        redFiltered: red._debug,
        bluePucks: blue.length,
        redPucks: red.length
      };
      
      return allPucks;
    }

    // --- Mode B: Legacy color detection (red/blue plastic) ---
    const maskR = new Uint8Array(procW*procH);
    const maskB = new Uint8Array(procW*procH);

    const colors = State.config.colors;
    const redT = colors.red;
    const blueT = colors.blue;

    function classifyPixel(r,g,b){
      const hsv = rgbToHsv(r,g,b);
      if (hsv.s < colors.sMin || hsv.v < colors.vMin) return 0;

      const dr = hueDist(hsv.h, redT.h);
      const db = hueDist(hsv.h, blueT.h);

      const isRedish = (r > g + 18) && (r > b + 18);
      const isBluish = (b > r + 10) && (b > g + 10);

      if (dr <= redT.hTol && hsv.s >= redT.s && hsv.v >= redT.v && isRedish) return 1;
      if (db <= blueT.hTol && hsv.s >= blueT.s && hsv.v >= blueT.v && isBluish) return 2;
      if (dr <= Math.max(12, redT.hTol*0.5) && hsv.s >= Math.max(colors.sMin, redT.s) && hsv.v >= Math.max(colors.vMin, redT.v)) return 1;
      if (db <= Math.max(12, blueT.hTol*0.5) && hsv.s >= Math.max(colors.sMin, blueT.s) && hsv.v >= Math.max(colors.vMin, blueT.v)) return 2;
      return 0;
    }

    for (let y=0; y<procH; y++){
      for (let x=0; x<procW; x++){
        const idx = y*procW + x;
        const p = idx*4;
        const r = data[p], g = data[p+1], b = data[p+2];

        if (useROI) {
          const pt = { x, y };
          if (!pointInTri(pt, At, Bt, Ct)) continue;
        }

        const c = classifyPixel(r,g,b);
        if (c === 1) maskR[idx]=1;
        else if (c === 2) maskB[idx]=1;
      }
    }

    const cleanR = clean(maskR);
    const cleanB = clean(maskB);

    const blobsR = extractBlobs(cleanR);
    const blobsB = extractBlobs(cleanB);

    const tol = State.config.puckRadiusTolerance;
    const expR = (State.config.puckRadius / ((scaleX+scaleY)/2));

    function filterColor(blobs, team){
      const out = [];
      for (const b of blobs){
        if (b.area < 180) continue;
        const rr = b.radius;
        if (rr < expR*(1-tol) || rr > expR*(1+tol)) continue;
        const ar = b.bbox.w / b.bbox.h;
        if (ar < 0.65 || ar > 1.55) continue;
        out.push({
          team,
          x: b.cx * scaleX,
          y: b.cy * scaleY,
          radius: rr * ((scaleX+scaleY)/2),
        });
      }
      out.sort((a,b)=>b.radius-a.radius);
      return out.slice(0, 8);
    }

    const red = filterColor(blobsR, "red");
    const blue = filterColor(blobsB, "blue");
    return [...red, ...blue];
  }
// ---------- Scoring ----------
  function scoreRound(pucks) {
    ensureTipIsC();
    const { tri, lines, puckRadius, lineThickness, touchEpsilon } = State.config;
    const { A,B,C } = tri;

    // Triangle edges (segments)
    const edges = [
      {a:A, b:B},
      {a:B, b:C},
      {a:C, b:A},
    ];

    // Precompute which side of each boundary line contains the tip (C)
    const tip = C;
    const tipSide = lines.map(L => Math.sign(whichSide(tip, L.p1, L.p2)) || 1);

    const results = [];
    const minClear = puckRadius + (lineThickness/2) + touchEpsilon;

    for (const puck of pucks){
      const center = { x: puck.x, y: puck.y };

      // Must be fully inside outer triangle (not touching edges)
      let ok = pointInTri(center, A,B,C);
      if (!ok){
        results.push({ ...puck, points: 0, valid:false, reason:"outside" });
        continue;
      }
      for (const e of edges){
        const d = distancePointToSegment(center, e.a, e.b);
        if (d <= minClear){
          ok = false;
          break;
        }
      }
      if (!ok){
        results.push({ ...puck, points: 0, valid:false, reason:"touch_outer" });
        continue;
      }

      // Must not touch any boundary lines
      let touches = false;
      for (const L of lines){
        const d = distancePointToSegment(center, L.p1, L.p2);
        if (d <= minClear){
          touches = true;
          break;
        }
      }
      if (touches){
        results.push({ ...puck, points: 0, valid:false, reason:"touch_line" });
        continue;
      }

      // Determine zone by half-plane tests against boundary lines
      // (C side of L0 => 10; else C side of L1 => 8; else C side of L2 => 7; else -10)
      const s0 = Math.sign(whichSide(center, lines[0].p1, lines[0].p2)) || 1;
      const s1 = Math.sign(whichSide(center, lines[1].p1, lines[1].p2)) || 1;
      const s2 = Math.sign(whichSide(center, lines[2].p1, lines[2].p2)) || 1;

      let points = -10;
      if (s0 === tipSide[0]) points = 10;
      else if (s1 === tipSide[1]) points = 8;
      else if (s2 === tipSide[2]) points = 7;
      else points = -10;

      results.push({ ...puck, points, valid:true, reason:"ok" });
    }

    // Sum per team
    const sum = { red:0, blue:0 };
    for (const r of results){
      if (r.team === "red") sum.red += r.points;
      if (r.team === "blue") sum.blue += r.points;
    }
    return { sum, results };
  }

  // ---------- UI rendering ----------
  function renderCameraHelp(err){
    return `
      <h3>Camera required</h3>
      <div class="hint">
        iPad Safari only allows camera access on <b>HTTPS</b> (or localhost).<br/><br/>
        Quick way:
        <ol>
          <li>Serve these files from a computer on your network using HTTPS (see instructions in the downloaded folder).</li>
          <li>Open the HTTPS URL on your iPad in Safari.</li>
          <li>Allow camera permission.</li>
        </ol>
      </div>
      <div class="sep"></div>
      <div class="hint"><b>Browser error:</b> ${String(err?.message || err)}</div>
    `;
  }

  function renderPanel() {
    const cfg = State.config;
    const mode = State.mode;

    const common = `
      <div class="row">
        <label>Line thickness</label>
        <div class="grow"><input id="lineThickness" type="range" min="2" max="30" step="1" value="${cfg.lineThickness}" /></div>
        <div class="badge">${cfg.lineThickness}px</div>
      </div>
      <div class="row">
        <label>Touch tolerance</label>
        <div class="grow"><input id="touchEpsilon" type="range" min="0" max="6" step="0.5" value="${cfg.touchEpsilon}" /></div>
        <div class="badge">${cfg.touchEpsilon.toFixed(1)}px</div>
      </div>
    `;

    if (mode === "calibrate_triangle") {
      return `
        <h3>Calibration 1/3 — Triangle</h3>
        <div class="hint">Drag the 3 points to match the scoring triangle corners. The right-most point will be treated as the <b>tip (10)</b>.</div>
        ${common}
        <div class="row">
          <button class="btn primary grow" id="btnNext">Next: Boundaries</button>
        </div>
        <div class="kbd">Tip: use your mouse to drag points precisely.</div>
      `;
    }

    if (mode === "calibrate_lines") {
      return `
        <h3>Calibration 2/3 — Boundaries</h3>
        <div class="hint">Drag the <b>three line segments</b> to align with the painted boundaries between 10/8, 8/7, and 7/-10.</div>
        ${common}
        <div class="row">
          <button class="btn grow" id="btnBack">Back</button>
          <button class="btn primary grow" id="btnNext">Next: Pucks</button>
        </div>
      `;
    }

    if (mode === "calibrate_pucks") {
      const red = cfg.colors.red;
      const blue = cfg.colors.blue;
      const st = cfg.stickers;
      const isSticker = cfg.detectorMode === "sticker";
      
      return `
        <h3>Calibration 3/3 — Pucks</h3>
        <div class="row">
          <label>Detection mode</label>
          <select id="detectorMode" class="grow">
            <option value="sticker" ${cfg.detectorMode==="sticker"?"selected":""}>Sticker (black/white)</option>
            <option value="color" ${cfg.detectorMode==="color"?"selected":""}>Legacy color (red/blue plastic)</option>
          </select>
        </div>
        <div class="hint">
          1) Adjust <b>puck radius</b> to match what you see.<br/>
          2) ${isSticker ? "Click <b>Sample Black</b>, then click on the BLUE puck's black sticker. Then <b>Sample White</b> and click on the RED puck's white sticker." : "Click the <b>red puck</b>, then the <b>blue puck</b> in the video to sample their colors."}
        </div>
        <div class="row">
          <label>Puck radius</label>
          <div class="grow"><input id="puckRadius" type="range" min="8" max="60" step="1" value="${cfg.puckRadius}" /></div>
          <div class="badge">${cfg.puckRadius}px</div>
        </div>
        <div class="row">
          <label>Radius tolerance</label>
          <div class="grow"><input id="puckTol" type="range" min="0.15" max="0.7" step="0.05" value="${cfg.puckRadiusTolerance}" /></div>
          <div class="badge">±${Math.round(cfg.puckRadiusTolerance*100)}%</div>
        </div>
        <div class="sep"></div>
        
        ${isSticker ? `
          <div class="hint"><b>Sticker Detection Tuning</b></div>
          <div class="row">
            <label>Black threshold</label>
            <div class="grow"><input id="blackThresh" type="range" min="10" max="150" step="5" value="${st.blackThresh}" /></div>
            <div class="badge">≤${st.blackThresh}</div>
          </div>
          <div class="row">
            <label>White threshold</label>
            <div class="grow"><input id="whiteThresh" type="range" min="100" max="250" step="5" value="${st.whiteThresh}" /></div>
            <div class="badge">≥${st.whiteThresh}</div>
          </div>
          <div class="row">
            <button class="btn grow" id="btnSampleBlack">Sample Black (Blue puck)</button>
          </div>
          <div class="row">
            <button class="btn grow" id="btnSampleWhite">Sample White (Red puck)</button>
          </div>
        ` : `
          <div class="hint"><b>Color Detection Tuning</b> (adjust until you see exactly your pucks, stable)</div>
          <div class="row">
            <label>Global S min</label>
            <div class="grow"><input id="sMin" type="range" min="0.10" max="0.90" step="0.02" value="${cfg.colors.sMin}" /></div>
            <div class="badge">${cfg.colors.sMin.toFixed(2)}</div>
          </div>
          <div class="row">
            <label>Global V min</label>
            <div class="grow"><input id="vMin" type="range" min="0.05" max="0.90" step="0.02" value="${cfg.colors.vMin}" /></div>
            <div class="badge">${cfg.colors.vMin.toFixed(2)}</div>
          </div>
          <div class="row">
            <label>Red hue tol</label>
            <div class="grow"><input id="redHTol" type="range" min="6" max="60" step="1" value="${cfg.colors.red.hTol}" /></div>
            <div class="badge">±${Math.round(cfg.colors.red.hTol)}°</div>
          </div>
          <div class="row">
            <label>Blue hue tol</label>
            <div class="grow"><input id="blueHTol" type="range" min="6" max="60" step="1" value="${cfg.colors.blue.hTol}" /></div>
            <div class="badge">±${Math.round(cfg.colors.blue.hTol)}°</div>
          </div>
          <div class="row">
            <button class="btn grow" id="btnSampleRed">Sample Red</button>
            <div class="badge">H=${Math.round(red.h)}±${Math.round(red.hTol)} S≥${red.s.toFixed(2)} V≥${red.v.toFixed(2)}</div>
          </div>
          <div class="row">
            <button class="btn grow" id="btnSampleBlue">Sample Blue</button>
            <div class="badge">H=${Math.round(blue.h)}±${Math.round(blue.hTol)} S≥${blue.s.toFixed(2)} V≥${blue.v.toFixed(2)}</div>
          </div>
        `}

        ${common}
        <div class="sep"></div>
        <div class="row">
          <label>Preview detection</label>
          <div class="grow"><input id="togglePreview" type="checkbox" ${State.detectionPreview.enabled ? "checked":""} /></div>
        </div>
        <div class="row">
          <button class="btn grow" id="btnBack">Back</button>
          <button class="btn primary grow" id="btnFinish">Finish calibration</button>
        </div>
        <div class="kbd">${isSticker ? "Click on the sticker center, not the metal puck edge." : "Click on the puck plastic (not the shiny metal center)."} Detected pucks will be drawn with labels.</div>
      `;
    }

    if (mode === "ready") {
      return `
        <h3>Ready</h3>
        <div class="hint">Calibration loaded. Start a game to begin scoring.</div>
        <div class="row">
          <button class="btn primary grow" id="btnStartGame">Start game</button>
          <button class="btn grow" id="btnRecalibrate">Recalibrate</button>
        </div>
        <div class="sep"></div>
        ${common}
        <div class="row">
          <button class="btn danger grow" id="btnClearCal">Clear calibration</button>
        </div>
      `;
    }

    if (mode === "game_setup") {
      return `
        <h3>New game</h3>
        <div class="hint">Choose a goal type then click <b>Begin</b>.</div>
        <div class="row">
          <label>Goal type</label>
          <select id="goalType" class="grow">
            <option value="points">Points</option>
            <option value="rounds">Rounds</option>
          </select>
        </div>
        <div class="row">
          <label>Goal value</label>
          <input id="goalValue" class="grow" type="number" min="1" max="999" value="75" />
        </div>
        <div class="row">
          <button class="btn grow" id="btnCancelGame">Cancel</button>
          <button class="btn primary grow" id="btnBeginGame">Begin</button>
        </div>
      `;
    }

    if (mode === "game") {
      return `
        <h3>Game controls</h3>
        <div class="hint">When all pucks have stopped, click <b>Score round</b>. Only pucks fully inside a zone (not touching any lines) count.</div>
        <div class="row">
          <button class="btn primary grow" id="btnScoreRound">Score round</button>
          <button class="btn grow" id="btnUndoRound">Undo</button>
        </div>
        <div class="row">
          <button class="btn danger grow" id="btnEndGame">End game</button>
        </div>
        <div class="kbd">Tip: you can also press <b>Space</b> to score a round (use a keyboard/remote if you like).</div>
      `;
    }

    return `<h3>Loading…</h3>`;
  }

  function wirePanelEvents() {
    // Common sliders
    const lt = $("#lineThickness");
    if (lt) lt.oninput = (e) => { State.config.lineThickness = Number(e.target.value); saveConfig(); render(); };

    const te = $("#touchEpsilon");
    if (te) te.oninput = (e) => { State.config.touchEpsilon = Number(e.target.value); saveConfig(); render(); };

    const pr = $("#puckRadius");
    if (pr) pr.oninput = (e) => { State.config.puckRadius = Number(e.target.value); saveConfig(); render(); };

    const pt = $("#puckTol");
    if (pt) pt.oninput = (e) => { State.config.puckRadiusTolerance = Number(e.target.value); saveConfig(); render(); };

    const detModeEl = $("#detectorMode");
    if (detModeEl) detModeEl.onchange = (e) => { State.config.detectorMode = e.target.value; saveConfig(); render(); };

    const sMinEl = $("#sMin");
    if (sMinEl) sMinEl.oninput = (e) => { State.config.colors.sMin = Number(e.target.value); saveConfig(); render(); };

    const vMinEl = $("#vMin");
    if (vMinEl) vMinEl.oninput = (e) => { State.config.colors.vMin = Number(e.target.value); saveConfig(); render(); };

    const redHTolEl = $("#redHTol");
    if (redHTolEl) redHTolEl.oninput = (e) => { State.config.colors.red.hTol = Number(e.target.value); saveConfig(); render(); };

    const blueHTolEl = $("#blueHTol");
    if (blueHTolEl) blueHTolEl.oninput = (e) => { State.config.colors.blue.hTol = Number(e.target.value); saveConfig(); render(); };

    const blackThreshEl = $("#blackThresh");
    if (blackThreshEl) blackThreshEl.oninput = (e) => { State.config.stickers.blackThresh = Number(e.target.value); saveConfig(); render(); };

    const whiteThreshEl = $("#whiteThresh");
    if (whiteThreshEl) whiteThreshEl.oninput = (e) => { State.config.stickers.whiteThresh = Number(e.target.value); saveConfig(); render(); };



    const tp = $("#togglePreview");
    if (tp) tp.onchange = (e) => { State.detectionPreview.enabled = !!e.target.checked; };

    // Buttons
    const btnNext = $("#btnNext");
    if (btnNext) btnNext.onclick = () => {
      if (State.mode === "calibrate_triangle") State.mode = "calibrate_lines";
      else if (State.mode === "calibrate_lines") State.mode = "calibrate_pucks";
      render();
    };

    const btnBack = $("#btnBack");
    if (btnBack) btnBack.onclick = () => {
      if (State.mode === "calibrate_lines") State.mode = "calibrate_triangle";
      else if (State.mode === "calibrate_pucks") State.mode = "calibrate_lines";
      render();
    };

    const btnFinish = $("#btnFinish");
    if (btnFinish) btnFinish.onclick = () => {
      saveConfig();
      State.mode = "ready";
      hintText.textContent = "Calibration complete. Start a game when you're ready.";
      render();
    };

    const btnRecal = $("#btnRecalibrate");
    if (btnRecal) btnRecal.onclick = () => { State.mode = "calibrate_triangle"; render(); };

    const btnClear = $("#btnClearCal");
    if (btnClear) btnClear.onclick = () => {
      State.config = defaultConfig();
      saveConfig();
      State.mode = "calibrate_triangle";
      render();
    };

    const btnStart = $("#btnStartGame");
    if (btnStart) btnStart.onclick = () => { State.mode = "game_setup"; render(); };

    const btnCancelGame = $("#btnCancelGame");
    if (btnCancelGame) btnCancelGame.onclick = () => { State.mode = "ready"; render(); };

    const btnBegin = $("#btnBeginGame");
    if (btnBegin) btnBegin.onclick = () => {
      const gt = $("#goalType").value;
      const gv = Number($("#goalValue").value || 0);
      State.game = {
        goalType: gt,
        goalValue: clamp(gv, 1, 999),
        rounds: [],
        totals: { red:0, blue:0 },
        startedAt: Date.now(),
        ended: false,
      };
      State.mode = "game";
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
      State.game.totals.red -= last.red;
      updateScoreboard();
    };

    const btnEnd = $("#btnEndGame");
    if (btnEnd) btnEnd.onclick = () => {
      if (!State.game) return;
      State.game.ended = true;
      State.mode = "ready";
      updateScoreboard();
      render();
    };

    const btnSampleBlack = $("#btnSampleBlack");
    if (btnSampleBlack) btnSampleBlack.onclick = () => { State.mode = "calibrate_pucks"; State.drag = { type:"sample", team:"black" }; render(); };

    const btnSampleWhite = $("#btnSampleWhite");
    if (btnSampleWhite) btnSampleWhite.onclick = () => { State.mode = "calibrate_pucks"; State.drag = { type:"sample", team:"white" }; render(); };

    const btnSampleRed = $("#btnSampleRed");
    if (btnSampleRed) btnSampleRed.onclick = () => { State.mode = "calibrate_pucks"; State.drag = { type:"sample", team:"red" }; render(); };

    const btnSampleBlue = $("#btnSampleBlue");
    if (btnSampleBlue) btnSampleBlue.onclick = () => { State.mode = "calibrate_pucks"; State.drag = { type:"sample", team:"blue" }; render(); };
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

    let summary = g.ended ? "Ended" : "In progress";
    summary += ` • Goal: ${g.goalType === "points" ? (g.goalValue + " pts") : (g.goalValue + " rounds")}`;
    gameSummaryEl.textContent = summary;

    // rounds grid
    roundGridBody.innerHTML = "";
    g.rounds.forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx+1}</td>
        <td class="blue">${r.blue}</td>
        <td class="red">${r.red}</td>
      `;
      roundGridBody.appendChild(tr);
    });

    // Win check
    if (!g.ended) {
      if (g.goalType === "points") {
        if (g.totals.blue >= g.goalValue || g.totals.red >= g.goalValue) {
          g.ended = true;
          hintText.textContent = "Goal reached. End the game or keep playing.";
        }
      } else {
        if (g.rounds.length >= g.goalValue) {
          g.ended = true;
          hintText.textContent = "Round goal reached. End the game or keep playing.";
        }
      }
    }
  }

  function doScoreRound() {
    if (!State.game || State.mode !== "game") return;

    // Use the same detection pipeline as the overlay (fresh snapshot)
    const pucks = detectPucksSnapshot({ roi: true });
    const scored = scoreRound(pucks);

    // Record round
    State.game.rounds.push({ blue: scored.sum.blue, red: scored.sum.red, detail: scored.results, ts: Date.now() });
    State.game.totals.blue += scored.sum.blue;
    State.game.totals.red += scored.sum.red;

    updateScoreboard();

    // Provide hint
    hintText.textContent = `Round ${State.game.rounds.length}: Blue ${scored.sum.blue}, Red ${scored.sum.red}. (${pucks.length} pucks detected)`;
    State.lastFrame = { pucks: scored.results, raw: pucks };
  }

  // Spacebar trigger
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (State.mode === "game") doScoreRound();
    }
  });

  // Reset
  $("#btnResetAll").onclick = () => {
    if (!confirm("Reset calibration AND current game?")) return;
    State.game = null;
    State.config = defaultConfig();
    saveConfig();
    State.mode = "calibrate_triangle";
    updateScoreboard();
    render();
  };

  // ---------- Overlay drawing ----------

  function getLiveDetections() {
    const now = performance.now();
    const interval = (State.mode === "game") ? 250 : 350; // ms
    if (now - State.detectCache.ts < interval) return State.detectCache;
    const pucks = detectPucksSnapshot({ roi: State.mode !== "calibrate_triangle" });
    let scored = null;
    // Only score if triangle+lines likely set (after triangle step)
    if (State.mode !== "calibrate_triangle") {
      scored = scoreRound(pucks);
    }
    
    // Update debug info in hint text during calibration
    if (State.mode === "calibrate_pucks" && pucks._debugInfo) {
      const d = pucks._debugInfo;
      const isSticker = State.config.detectorMode === "sticker";
      if (isSticker) {
        hintText.textContent = `Detection: ${d.blackBlobs} black blobs → ${d.bluePucks} blue pucks | ${d.whiteBlobs} white blobs → ${d.redPucks} red pucks`;
      }
    }
    
    State.detectCache = { ts: now, pucks, scored };
    return State.detectCache;
  }

  function drawOverlay() {
    const W = overlay.width, H = overlay.height;
    ctx.clearRect(0,0,W,H);

    // Semi-transparent dark gradient for readability
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#000";
    ctx.fillRect(0,0,W,H);
    ctx.restore();

    const cfg = State.config;
    const t = cfg.lineThickness * devicePixelRatio;
    const r = cfg.puckRadius * devicePixelRatio;

    // Draw triangle & boundaries
    const A = scale(cfg.tri.A), B = scale(cfg.tri.B), C = scale(cfg.tri.C);
    const lines = cfg.lines.map(L => ({ p1: scale(L.p1), p2: scale(L.p2) }));

    // Triangle
    ctx.lineWidth = t;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.lineTo(C.x,C.y); ctx.closePath();
    ctx.stroke();

    // Boundaries
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    lines.forEach((L, i) => {
      ctx.beginPath();
      ctx.moveTo(L.p1.x, L.p1.y);
      ctx.lineTo(L.p2.x, L.p2.y);
      ctx.stroke();
    });

    // Label zones (very rough text positions)
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = `${14*devicePixelRatio}px system-ui`;
    const tip = C;
    ctx.fillText("10", (tip.x + (A.x+B.x)/2)/2, (tip.y + (A.y+B.y)/2)/2);
    ctx.restore();

    // Calibration handles
    if (State.mode.startsWith("calibrate")) {
      // triangle points
      drawHandle(A, "A");
      drawHandle(B, "B");
      drawHandle(C, "C");

      if (State.mode !== "calibrate_triangle") {
        // line endpoint handles
        lines.forEach((L, idx) => {
          drawHandle(L.p1, `L${idx+1}a`, true);
          drawHandle(L.p2, `L${idx+1}b`, true);
        });
      }

      if (State.mode === "calibrate_pucks") {
        // radius preview circle at center of view
        const mid = { x: W*0.5, y: H*0.5 };
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = "rgba(74,163,255,0.9)";
        ctx.lineWidth = 3*devicePixelRatio;
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, r, 0, Math.PI*2);
        ctx.stroke();
        ctx.fillStyle = "rgba(74,163,255,0.15)";
        ctx.fill();
        ctx.restore();

        // If sampling, draw cursor hint
        if (State.drag && State.drag.type === "sample") {
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = "rgba(251,191,36,0.9)";
          ctx.font = `${12*devicePixelRatio}px system-ui`;
          ctx.fillText(`Click a ${State.drag.team.toUpperCase()} puck…`, 14*devicePixelRatio, 20*devicePixelRatio);
          ctx.restore();
        }
      }
    }

    // Live detections overlay (during calibration and play)
    const live = getLiveDetections();
    const puckRadiusPx = State.config.puckRadius * devicePixelRatio;

    if (live && live.pucks) {
      // If we have scoring available, use it to label points; else just show color.
      const byKey = new Map();
      if (live.scored && live.scored.results) {
        for (const r of live.scored.results) {
          // Key by approximate position
          byKey.set(`${Math.round(r.x)}:${Math.round(r.y)}:${r.team}`, r);
        }
      }

      for (const p of live.pucks) {
        const key = `${Math.round(p.x)}:${Math.round(p.y)}:${p.team}`;
        const scored = byKey.get(key);
        const points = scored ? scored.points : 0;
        const valid = scored ? scored.valid : true;

        const col = p.team === "blue" ? "rgba(74,163,255,0.95)" : "rgba(255,91,91,0.95)";
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 3*devicePixelRatio;
        ctx.beginPath();
        ctx.arc(p.x*devicePixelRatio, p.y*devicePixelRatio, puckRadiusPx, 0, Math.PI*2);
        ctx.stroke();

        // label background
        const label = (live.scored ? `${points}` : p.team.toUpperCase());
        ctx.font = `${14*devicePixelRatio}px system-ui`;
        const tx = p.x*devicePixelRatio + 10*devicePixelRatio;
        const ty = p.y*devicePixelRatio - 10*devicePixelRatio;

        ctx.fillStyle = valid ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.75)";
        const m = ctx.measureText(label);
        ctx.fillRect(tx-4*devicePixelRatio, ty-14*devicePixelRatio, (m.width+8*devicePixelRatio), 18*devicePixelRatio);

        ctx.fillStyle = valid ? col : "rgba(255,255,255,0.9)";
        ctx.fillText(label, tx, ty);
        ctx.restore();
      }
    }  }

  function drawHandle(p, label, small=false) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = small ? "rgba(251,191,36,0.95)" : "rgba(54,211,153,0.95)";
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2*devicePixelRatio;
    const rad = (small ? 7 : 9) * devicePixelRatio;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.font = `${11*devicePixelRatio}px system-ui`;
    ctx.fillText(label, p.x + rad + 3*devicePixelRatio, p.y + 4*devicePixelRatio);
    ctx.restore();
  }

  function scale(p){
    return { x: p.x * devicePixelRatio, y: p.y * devicePixelRatio };
  }
  function unscale(p){
    return { x: p.x / devicePixelRatio, y: p.y / devicePixelRatio };
  }

  // ---------- Pointer / mouse interaction ----------
  function getPointerPos(evt) {
    const rect = overlay.getBoundingClientRect();
    const x = (evt.clientX - rect.left) * devicePixelRatio;
    const y = (evt.clientY - rect.top) * devicePixelRatio;
    return { x, y };
  }

  function hitTestHandles(pos) {
    const cfg = State.config;
    const handles = [];
    // Triangle points
    handles.push({ type:"tri", key:"A", p: scale(cfg.tri.A) });
    handles.push({ type:"tri", key:"B", p: scale(cfg.tri.B) });
    handles.push({ type:"tri", key:"C", p: scale(cfg.tri.C) });

    if (State.mode !== "calibrate_triangle") {
      cfg.lines.forEach((L, idx) => {
        handles.push({ type:"line", idx, end:"p1", p: scale(L.p1) });
        handles.push({ type:"line", idx, end:"p2", p: scale(L.p2) });
      });
    }

    const R = 14 * devicePixelRatio;
    for (const h of handles) {
      if (Math.hypot(pos.x - h.p.x, pos.y - h.p.y) <= R) return h;
    }
    return null;
  }

  overlay.addEventListener("pointerdown", (evt) => {
    overlay.setPointerCapture(evt.pointerId);
    const pos = getPointerPos(evt);

    // If sampling puck colors, capture pixel under click
    if (State.mode === "calibrate_pucks" && State.drag && State.drag.type === "sample") {
      if (State.drag.team === "black" || State.drag.team === "white") sampleStickerAt(pos, State.drag.team);
      else sampleColorAt(pos, State.drag.team);
      State.drag = null;
      render();
      return;
    }

    if (!State.mode.startsWith("calibrate")) return;
    const hit = hitTestHandles(pos);
    if (hit) {
      State.drag = { ...hit, offset: { dx: pos.x - hit.p.x, dy: pos.y - hit.p.y } };
    }
  });

  overlay.addEventListener("pointermove", (evt) => {
    if (!State.drag || !State.mode.startsWith("calibrate")) return;
    const pos = getPointerPos(evt);
    const p = { x: pos.x - State.drag.offset.dx, y: pos.y - State.drag.offset.dy };
    const u = unscale(p);

    if (State.drag.type === "tri") {
      State.config.tri[State.drag.key] = { x: u.x, y: u.y };
      saveConfig();
    } else if (State.drag.type === "line") {
      const L = State.config.lines[State.drag.idx];
      L[State.drag.end] = { x: u.x, y: u.y };
      saveConfig();
    }
  });

  overlay.addEventListener("pointerup", (evt) => {
    State.drag = null;
  });

  // ---------- Color sampling ----------
  function sampleStickerAt(pos, which) {
    const W = overlay.width, H = overlay.height;
    wctx.drawImage(video, 0, 0, W, H);
    const x = Math.round(clamp(pos.x, 0, W-1));
    const y = Math.round(clamp(pos.y, 0, H-1));
    
    // Sample 3x3 area and average to reduce noise
    let graySum = 0, count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sx = clamp(x + dx, 0, W-1);
        const sy = clamp(y + dy, 0, H-1);
        const px = wctx.getImageData(sx, sy, 1, 1).data;
        graySum += (0.2126*px[0] + 0.7152*px[1] + 0.0722*px[2]);
        count++;
      }
    }
    const gray = graySum / count;

    if (which === "black") {
      // Set threshold to allow pixels up to 40% brighter than sample
      // This handles slight lighting variations and edge pixels
      State.config.stickers.blackThresh = Math.min(150, Math.max(20, Math.round(gray * 1.4)));
      hintText.textContent = `Sampled BLACK sticker at gray=${Math.round(gray)} → black≤${State.config.stickers.blackThresh} (allowing +40% brightness)`;
    } else {
      // Set threshold to allow pixels down to 15% darker than sample
      State.config.stickers.whiteThresh = Math.min(245, Math.max(100, Math.round(gray * 0.85)));
      hintText.textContent = `Sampled WHITE sticker at gray=${Math.round(gray)} → white≥${State.config.stickers.whiteThresh} (allowing -15% brightness)`;
    }
    saveConfig();
  }

  function sampleColorAt(pos, team) {
    const W = overlay.width, H = overlay.height;
    // draw current frame to work
    wctx.drawImage(video, 0, 0, W, H);
    const x = Math.round(clamp(pos.x, 0, W-1));
    const y = Math.round(clamp(pos.y, 0, H-1));
    const px = wctx.getImageData(x, y, 1, 1).data;
    const hsv = rgbToHsv(px[0], px[1], px[2]);

    const target = State.config.colors[team];
    target.h = hsv.h;
    // be a bit permissive; user can re-sample
    target.hTol = team === "red" ? 26 : 28;
    target.s = Math.max(0.35, Math.min(0.75, hsv.s * 0.75));
    target.v = Math.max(0.20, Math.min(0.65, hsv.v * 0.70));
    saveConfig();
    hintText.textContent = `Sampled ${team.toUpperCase()} at H=${Math.round(hsv.h)} S=${hsv.s.toFixed(2)} V=${hsv.v.toFixed(2)}.`;
  }

  // ---------- Main render/loop ----------
  function render() {
    panel.innerHTML = renderPanel();
    wirePanelEvents();

    if (State.mode === "init") setStatus("Starting…", "warn");
    else if (State.mode.startsWith("calibrate")) setStatus("Calibrating", "warn");
    else if (State.mode === "ready") setStatus("Ready", "ok");
    else if (State.mode === "game" || State.mode === "game_setup") setStatus("Game", "ok");
  }

  function loop() {
    // Keep overlay sized in sync (Safari sometimes changes layout)
    // only if mismatch
    const rect = overlay.getBoundingClientRect();
    const needW = Math.round(rect.width * devicePixelRatio);
    const needH = Math.round(rect.height * devicePixelRatio);
    if (overlay.width !== needW || overlay.height !== needH) {
      resizeCanvases();
    }

    drawOverlay();
    requestAnimationFrame(loop);
  }

  // ---------- Boot ----------
  function boot() {
    State.config = loadConfig();
    State.mode = "calibrate_triangle"; // always start in calibration for MVP, unless you already calibrated
    // If we have a config saved (heuristic: lineThickness and tri positions exist), jump to ready
    const raw = localStorage.getItem(LS_KEY);
    if (raw) State.mode = "ready";

    render();
    updateScoreboard();
    startCamera();
  }

  boot();

  // ---------- README (as comment) ----------
  /*
  =========================
  Running on iPad Safari
  =========================
  iOS requires camera access to be served from HTTPS (secure context).

  Easiest local HTTPS option (Mac/Linux with node):
    1) Install mkcert (one-time): https://github.com/FiloSottile/mkcert
    2) In this folder, run:
         mkcert -install
         mkcert localhost 127.0.0.1 ::1
       This creates two files: localhost+2.pem and localhost+2-key.pem
    3) Install http-server:
         npm i -g http-server
    4) Start HTTPS server:
         http-server -S -C localhost+2.pem -K localhost+2-key.pem -p 8443
    5) On iPad, open:
         https://<your-computer-ip>:8443
       (Accept the certificate prompt.)

  Alternative (Python 3.10+):
    - Create a cert (mkcert is easiest), then:
      python3 -m http.server 8443 --bind 0.0.0.0
    - This is HTTP, not HTTPS. Camera may be blocked on iOS.

  If you don't want local HTTPS:
    - Put these files on any static HTTPS host (e.g. GitHub Pages) and open on iPad.
    - Processing still happens locally in the browser.
  */
})();
