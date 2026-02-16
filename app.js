// Garage Shuffleboard Scorer (MVP)
// Runs entirely in-browser (Safari iPad). No backend.
// Notes on iPad camera security:
// - getUserMedia requires a secure context (HTTPS) or localhost.
// - See README at bottom of this file for a quick local-HTTPS method.

(() => {
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

  const LS_KEY = "shuffleboard_mvp_v1";

  const State = {
    mode: "init", // init | calibrate_triangle | calibrate_lines | calibrate_pucks | ready | game_setup | game
    drag: null,
    lastFrame: null,
    config: null,
    game: null,
    detectionPreview: { enabled: true },
  };

  // ---------- Default config ----------
  function defaultConfig() {
    return {
      lineThickness: 10, // px in overlay / video coordinate space
      puckRadius: 18,    // px (set in calibration)
      puckRadiusTolerance: 0.35, // +/- 35% area/size acceptance
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
        { p1: { x: 430, y: 260 }, p2: { x: 430, y: 340 } }, // between 10 and 8 (near tip)
        { p1: { x: 340, y: 230 }, p2: { x: 360, y: 380 } }, // between 8 and 7
        { p1: { x: 220, y: 200 }, p2: { x: 260, y: 420 } }, // between 7 and -10 (near base)
      ],
      // Color thresholds (HSV-ish) for red/blue
      // Hue in [0,360), S and V in [0,1]
      colors: {
        red: { h: 0, s: 0.55, v: 0.35, hTol: 22 },  // seed values; user samples
        blue:{ h: 210, s: 0.50, v: 0.30, hTol: 25 },
        sMin: 0.35,
        vMin: 0.20,
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
  function detectPucksSnapshot() {
    const rect = overlay.getBoundingClientRect();
    const W = overlay.width;
    const H = overlay.height;

    // Draw current video frame into work canvas (same size as overlay)
    wctx.drawImage(video, 0, 0, W, H);

    // Downscale for processing speed
    const procW = Math.round(W / 2);
    const procH = Math.round(H / 2);

    // Create a temp canvas (offscreen) by scaling draw onto itself via drawImage
    // We'll just use getImageData on a scaled image by drawing to an ImageData-sized buffer
    const tmp = document.createElement("canvas");
    tmp.width = procW; tmp.height = procH;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.drawImage(work, 0, 0, procW, procH);

    const img = tctx.getImageData(0,0,procW,procH);
    const data = img.data;

    // label arrays for red and blue separately
    const labelsR = new Int32Array(procW*procH);
    const labelsB = new Int32Array(procW*procH);

    // Union-Find
    function ufInit(max){
      return { parent: Array.from({length:max+1}, (_,i)=>i), rank: new Int8Array(max+1) };
    }
    function ufFind(uf, x){
      let p = uf.parent[x];
      while (p !== uf.parent[p]) p = uf.parent[p];
      while (x !== p){
        const nx = uf.parent[x];
        uf.parent[x] = p;
        x = nx;
      }
      return p;
    }
    function ufUnion(uf, a,b){
      a = ufFind(uf,a); b = ufFind(uf,b);
      if (a===b) return;
      if (uf.rank[a] < uf.rank[b]) uf.parent[a] = b;
      else if (uf.rank[a] > uf.rank[b]) uf.parent[b] = a;
      else { uf.parent[b]=a; uf.rank[a]++; }
    }

    // First pass CCL (4-connected), separate for each team
    function labelFor(mask, labels){
      let next = 1;
      const uf = ufInit(procW*procH/2|0); // over-allocate; adjust later if needed
      // We'll grow uf.parent dynamically if next exceeds
      function ensureUF(n){
        if (n < uf.parent.length) return;
        const old = uf.parent.length;
        const newLen = Math.max(n+1, old*2);
        uf.parent.length = newLen;
        for (let i=old;i<newLen;i++) uf.parent[i]=i;
        const nr = new Int8Array(newLen);
        nr.set(uf.rank);
        uf.rank = nr;
      }

      for (let y=0; y<procH; y++){
        for (let x=0; x<procW; x++){
          const i = y*procW + x;
          if (!mask[i]) { labels[i]=0; continue; }
          const left = (x>0) ? labels[i-1] : 0;
          const up = (y>0) ? labels[i-procW] : 0;
          if (left===0 && up===0){
            labels[i]=next;
            ensureUF(next+1);
            next++;
          } else if (left!==0 && up===0){
            labels[i]=left;
          } else if (left===0 && up!==0){
            labels[i]=up;
          } else {
            labels[i]=Math.min(left, up);
            if (left!==up) ufUnion(uf, left, up);
          }
        }
      }

      // Second pass: compress + stats
      const stats = new Map(); // root -> {area,sumx,sumy,minx,maxx,miny,maxy}
      for (let i=0;i<labels.length;i++){
        const lab = labels[i];
        if (!lab) continue;
        const root = ufFind(uf, lab);
        labels[i]=root;
        const x = i % procW;
        const y = (i / procW) | 0;
        let s = stats.get(root);
        if (!s){
          s = { area:0, sumx:0, sumy:0, minx:x, maxx:x, miny:y, maxy:y };
          stats.set(root, s);
        }
        s.area++;
        s.sumx += x;
        s.sumy += y;
        s.minx = Math.min(s.minx, x);
        s.maxx = Math.max(s.maxx, x);
        s.miny = Math.min(s.miny, y);
        s.maxy = Math.max(s.maxy, y);
      }

      return Array.from(stats.values()).map(s => {
        const cx = s.sumx / s.area;
        const cy = s.sumy / s.area;
        const radius = Math.sqrt(s.area / Math.PI);
        return { cx, cy, area: s.area, radius, bbox: {x0:s.minx,y0:s.miny,x1:s.maxx,y1:s.maxy} };
      });
    }

    // Build masks by classifying pixels
    const maskR = new Uint8Array(procW*procH);
    const maskB = new Uint8Array(procW*procH);

    for (let y=0; y<procH; y++){
      for (let x=0; x<procW; x++){
        const idx = (y*procW + x);
        const p = idx*4;
        const r = data[p], g = data[p+1], b = data[p+2];
        const hsv = rgbToHsv(r,g,b);
        if (isColor(hsv, State.config.colors.red)) maskR[idx]=1;
        if (isColor(hsv, State.config.colors.blue)) maskB[idx]=1;
      }
    }

    // Label & extract blobs
    const blobsR = labelFor(maskR, labelsR);
    const blobsB = labelFor(maskB, labelsB);

    // Convert to overlay coordinates and filter by size around expected puck radius
    const scaleX = W / procW;
    const scaleY = H / procH;
    const expR = State.config.puckRadius / ((scaleX+scaleY)/2);
    const tol = State.config.puckRadiusTolerance;

    function filter(blobs){
      const out = [];
      for (const b of blobs){
        // basic sanity: not tiny specks
        if (b.area < 80) continue;
        const rr = b.radius;
        if (rr < expR*(1-tol) || rr > expR*(1+tol)) continue;

        out.push({
          x: b.cx * scaleX,
          y: b.cy * scaleY,
          radius: rr * ((scaleX+scaleY)/2),
        });
      }
      return out;
    }

    const red = filter(blobsR).map(o => ({...o, team:"red"}));
    const blue = filter(blobsB).map(o => ({...o, team:"blue"}));
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
      return `
        <h3>Calibration 3/3 — Pucks</h3>
        <div class="hint">
          1) Adjust <b>puck radius</b> to match what you see.<br/>
          2) Click the <b>red puck</b>, then the <b>blue puck</b> in the video to sample their colors.
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
        ${common}
        <div class="sep"></div>
        <div class="row">
          <button class="btn grow" id="btnSampleRed">Sample Red</button>
          <div class="badge">H=${Math.round(red.h)}±${Math.round(red.hTol)} S≥${red.s.toFixed(2)} V≥${red.v.toFixed(2)}</div>
        </div>
        <div class="row">
          <button class="btn grow" id="btnSampleBlue">Sample Blue</button>
          <div class="badge">H=${Math.round(blue.h)}±${Math.round(blue.hTol)} S≥${blue.s.toFixed(2)} V≥${blue.v.toFixed(2)}</div>
        </div>
        <div class="row">
          <label>Preview detection</label>
          <div class="grow"><input id="togglePreview" type="checkbox" ${State.detectionPreview.enabled ? "checked":""} /></div>
        </div>
        <div class="row">
          <button class="btn grow" id="btnBack">Back</button>
          <button class="btn primary grow" id="btnFinish">Finish calibration</button>
        </div>
        <div class="kbd">While sampling: click on the puck plastic (not the shiny metal center).</div>
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

    // Detect pucks in this frame
    const pucks = detectPucksSnapshot();
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

        // Detection preview
        if (State.detectionPreview.enabled) {
          const pucks = detectPucksSnapshot();
          for (const p of pucks) {
            const col = p.team === "blue" ? "rgba(74,163,255,0.95)" : "rgba(255,91,91,0.95)";
            ctx.save();
            ctx.strokeStyle = col;
            ctx.lineWidth = 3*devicePixelRatio;
            ctx.beginPath();
            ctx.arc(p.x*devicePixelRatio, p.y*devicePixelRatio, p.radius*devicePixelRatio, 0, Math.PI*2);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    }

    // In-game: show last detection & scored pucks overlay
    if (State.mode === "game" && State.lastFrame?.pucks) {
      for (const p of State.lastFrame.pucks) {
        const center = { x: p.x*devicePixelRatio, y: p.y*devicePixelRatio };
        const col = p.team === "blue" ? "rgba(74,163,255,0.95)" : "rgba(255,91,91,0.95)";
        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 3*devicePixelRatio;
        ctx.beginPath();
        ctx.arc(center.x, center.y, cfg.puckRadius*devicePixelRatio, 0, Math.PI*2);
        ctx.stroke();

        // label
        ctx.fillStyle = p.valid ? col : "rgba(255,255,255,0.85)";
        ctx.font = `${14*devicePixelRatio}px system-ui`;
        const label = p.valid ? `${p.points}` : "0";
        ctx.fillText(label, center.x + 8*devicePixelRatio, center.y - 8*devicePixelRatio);
        ctx.restore();
      }
    }
  }

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
      sampleColorAt(pos, State.drag.team);
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
