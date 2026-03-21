/**
 * Cosmic Emergence — Blockchain Edition
 *
 * CHANGES FROM v3:
 * - Agent no longer fires on local entropy — only on blockchain bid events
 * - window.onBidReceived(bidData) is the single external trigger
 * - BidderChroma system: each bidder address seeds a unique nebula color
 * - phaseBoost: auction bid count pushes cosmic phase forward
 * - Frame capture on blockchain event → POST to bridge server for minting
 * - Auction settle → animation locks into final stable phase
 * - WebSocket client auto-connects to bridge server on localhost:3131
 * - Graceful fallback: runs beautifully even with no server connected
 *
 * CAPTURE TRIGGER — Peak Detection (not a timer):
 * After a bid injects geometry, a PeakWatcher is registered for that mesh.
 * Each tick, the watcher scores the current visual state using:
 *   luminanceScore = geometry brightness (rotation-dependent wireframe visibility)
 *                  × chromaIntensity (how saturated the bidder color is right now)
 *                  × phaseCoherence (are we in a structured phase? more = better image)
 * The watcher tracks a rolling derivative. When score peaks and starts falling,
 * it fires the capture — the agent caught the exact moment of maximum visual impact.
 * Minimum capture window: 0.8s post-inject (avoid capturing the spawn flash).
 * Maximum window: 5.5s (geometry still fully visible, before fade begins at 6s).
 */

// ── BRIDGE CONNECTION ─────────────────────────────────────────────
// Top-level clamp — used by peak watcher and other outer-scope functions
// (also re-defined inside window.load for inner scope convenience)
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

const BRIDGE_URL = 'ws://localhost:3131';
const BRIDGE_HTTP = 'http://localhost:3131';
let bridgeWS = null;
let bridgeConnected = false;
let bridgeReconnectTimer = null;

function connectBridge() {
  if (bridgeWS && bridgeWS.readyState <= 1) return;
  try {
    bridgeWS = new WebSocket(BRIDGE_URL);

    bridgeWS.onopen = () => {
      bridgeConnected = true;
      console.log('🌉 Bridge connected');
      updateHUD('bridge', '⛓️ LIVE');
    };

    bridgeWS.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        handleBridgeMessage(msg);
      } catch(e) { console.error('Bridge parse error', e); }
    };

    bridgeWS.onclose = () => {
      bridgeConnected = false;
      updateHUD('bridge', '○ offline');
      // Reconnect after 5s
      clearTimeout(bridgeReconnectTimer);
      bridgeReconnectTimer = setTimeout(connectBridge, 5000);
    };

    bridgeWS.onerror = () => {
      // Silently fail — animation keeps running in standalone mode
    };
  } catch(e) {
    // WebSocket not available or blocked
  }
}

function handleBridgeMessage(msg) {
  const cp = cosmicState ? cosmicState.pos : new THREE.Vector3(0, 0, 0);

  switch(msg.type) {
    case 'INIT':
      console.log(`🌌 Init: ${msg.bidCount} bids so far, phase: ${msg.auctionPhase}`);
      // Apply accumulated phase boost from existing bids
      if (msg.bidCount > 0) {
        externalPhaseBoost = Math.min(msg.bidCount * 0.08, 0.4);
        updateHUD('bids', `${msg.bidCount} bids`);
      }
      break;

    case 'BID':
      console.log(`🎯 BID #${msg.bid.count}: ${msg.bid.amount} ETH from ${msg.bid.address.slice(0,10)}...`);
      if (msg.auctionPhase === 'active') updateHUD('auction', `🔴 ${msg.bid.amount} ETH`);
      window.onBidReceived(msg.bid, msg.visual, cp);
      break;

    case 'AUCTION_STARTED':
      console.log('🚀 Auction started — resetting to chaos phase');
      auctionStarted = true;
      externalPhaseBoost = 0;
      updateHUD('auction', '🔴 LIVE AUCTION');
      break;

    case 'MINT_COMPLETE':
      // Server confirms a Bidder's Edition was minted — update HUD
      console.log(`✅ Minted token ${msg.tokenId} for bid #${msg.bidCount} (peak=${msg.peakScore})`);
      updateHUD('mints', `token ${msg.tokenId}`);
      break;

    case 'AUCTION_SETTLED':
      console.log('🏁 Auction settled — locking final phase');
      auctionSettled = true;
      updateHUD('auction', '✅ SETTLED');
      // Capture final canonical frame after 2s (let geometry settle)
      setTimeout(() => {
        sendCapture(captureFrame(), {
          count: 0, address: 'canonical',
          amount: '0', txHash: 'final', isCanonical: true
        });
      }, 2000);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════
// NON-BLOCKING CAPTURE — zero impact on animation frame rate
//
// The ONLY safe approach on all browsers:
// ═══════════════════════════════════════════════════════════════════

const cSnap = document.createElement('canvas');
cSnap.width = 2560; cSnap.height = 1440; // 2K capture — high-res NFT, practical transfer size
const ctxSnap = cSnap.getContext('2d', { alpha: false });
ctxSnap.imageSmoothingEnabled = true;
ctxSnap.imageSmoothingQuality = 'high';

// ═══════════════════════════════════════════════════════════════════
// NON-BLOCKING CAPTURE — definitive approach
//
// ALL previous approaches (toDataURL, toBlob, OffscreenCanvas, requestIdleCallback)
// still caused freezes because PNG COMPRESSION itself runs on the main thread
// or compositor thread on Chrome/Windows, starving the rAF.
//
// Solution: don't compress PNG in the browser at all.
//   captureFrame() → getImageData() → raw RGBA Uint8ClampedArray (~2ms, no compress)
//   sendCapture()  → fetch() with raw binary body (ArrayBuffer, instant)
//   server.js      → receives raw RGBA → encodes PNG using Node 'sharp' or 'pngjs'
//
// The browser does: read pixels (2ms) + send bytes (network, async).
// The server does: PNG encode (50-100ms, doesn't affect animation at all).
// Animation thread: never blocked, ever.
// ═══════════════════════════════════════════════════════════════════

// captureFrame(): ZERO cost. Called inside rAF tick.
function captureFrame() {
  return { scheduledAt: performance.now() };
}

// sendCapture(): reads raw RGBA from cSnap and posts to bridge.
// cSnap is a plain 2D canvas (never WebGL) — getImageData is a safe CPU read.
// 200ms delay ensures the compositor has fully painted before we read pixels.
function sendCapture(token, bidData, peakScore) {
  const meta = {
    bidData,
    peakScore: peakScore != null ? Number(peakScore.toFixed(4)) : null,
    phaseVector: currentPhaseWeights.slice().map(v => Number(v.toFixed(3))),
    captureTimestamp: new Date().toISOString(),
    width: 2560, height: 1440
  };

  setTimeout(() => {
    let pixels;
    try {
      pixels = ctxSnap.getImageData(0, 0, 2560, 1440).data.buffer;
    } catch(e) {
      console.warn('Capture read failed:', e.message);
      return;
    }
    // Retry helper — one automatic retry after 500ms if first attempt fails
    function doFetch(attempt) {
      fetch(`${BRIDGE_HTTP}/capture-raw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Capture-Meta': encodeURIComponent(JSON.stringify(meta))
        },
        body: pixels
      })
      .then(r => r.json())
      .then(result => {
        console.log('📬 Capture → mint:', result.mint?.tokenId || result.mint?.error);
        updateHUD('mints', String(result.mint?.tokenId || 'pending'));
      })
      .catch(e => {
        if (attempt < 2) {
          console.warn(`Capture attempt ${attempt} failed, retrying in 500ms...`);
          setTimeout(() => doFetch(attempt + 1), 500);
        } else {
          console.warn('Capture failed after retry:', e.message);
        }
      });
    }
    doFetch(1);
  }, 120); // 120ms = 3 full frames at 24fps, cSnap is always written by then
}

// downloadFrameManual: key-9 manual save. Reads cSnap → PNG via toBlob.
function downloadFrameManual(token, frameNum, pw) {
  setTimeout(() => {
    const fc = document.createElement('canvas');
    fc.width = 2560; fc.height = 1440;
    fc.getContext('2d').drawImage(cSnap, 0, 0);
    fc.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cosmic-${frameNum}-${pw.map(v=>v.toFixed(2)).join('-')}.png`;
      a.click();
    }, 'image/png');
  }, 120); // 120ms = 3 full frames at 24fps, cSnap is always written by then
}

// ── HUD overlay ───────────────────────────────────────────────────
const hudData = { bridge: '○ offline', auction: '○ idle', bids: '0 bids', mints: '—' };
function updateHUD(key, val) {
  hudData[key] = val;
  const el = document.getElementById('hud');
  if (el) el.innerHTML = [
    `<span style="color:#888">BRIDGE</span> ${hudData.bridge}`,
    `<span style="color:#888">AUCTION</span> ${hudData.auction}`,
    `<span style="color:#888">BIDS</span> ${hudData.bids}`,
    `<span style="color:#888">MINTED</span> ${hudData.mints}`,
  ].join(' &nbsp;|&nbsp; ');
}

// ── AGENT SYSTEM ─────────────────────────────────────────────────────
let scene;
let cOut;
let pMat; // hoisted — assigned inside window.load, used by applyBidPulses
let _localBidCount = 0; // mock bid counter (B key only)
let cosmicState = null;        // updated each tick so bridge handlers can access
let currentPhaseWeights = [0.5, 0.5, 0, 0, 0]; // updated each tick
let externalPhaseBoost = 0;    // set by bid events, decays over time
let auctionStarted = false;
let auctionSettled = false;
let bidderChromaStack = [];    // per-bid nebula color overrides
let lastCaptureTime = 0;       // ms timestamp — minimum 2s gap between captures

// ── Peak Watcher ──────────────────────────────────────────────────
// One watcher per active bid. Ticked every animation frame.
// Fires capture at the moment visual score peaks and begins to fall.
const peakWatchers = [];

/**
 * Register a PeakWatcher for a bid.
 * mesh      : the THREE.Mesh injected for this bid
 * bidData   : { count, address, amount, txHash, ... }
 * chromaColor : THREE.Color (bidder's unique hue)
 *
 * Scoring formula (all factors 0–1):
 *   geometryScore  = wireframe luminance proxy: how "open" the rotation is
 *                    (peaks when diagonal faces are most visible ~1.5–2s)
 *   chromaScore    = bidderChromaStack intensity (fades over 8s)
 *   phaseScore     = how structured the cosmos is (web/stable = richer image)
 *   combined       = geo * 0.5 + chroma * 0.3 + phase * 0.2
 *
 * Derivative check: if score[t] < score[t-1] * 0.97 AND t > MIN_WINDOW,
 * peak has passed — fire capture.
 * Hard cap at MAX_WINDOW to guarantee we always get a shot.
 */
function registerPeakWatcher(mesh, bidData, chromaColor) {
  peakWatchers.push({
    mesh,
    bidData,
    chromaColor,
    birth: performance.now(),
    lastScore: 0,
    peakScore: 0,
    peakFired: false,
    consecutiveDecays: 0,  // must decline 2 frames in a row before firing
    MIN_WINDOW: 400,   // ms — just enough to skip bid arrival flash
    MAX_WINDOW: 3000,  // ms — hard deadline, ensures capture within 3s of bid
  });
}

/**
 * Called every tick. Evaluates all active watchers.
 * When a watcher detects peak-passed or timeout, it fires & removes itself.
 */
function tickPeakWatchers(pw, chromaStack) {
  const now = performance.now();

  for (let i = peakWatchers.length - 1; i >= 0; i--) {
    const w = peakWatchers[i];
    if (w.peakFired) { peakWatchers.splice(i, 1); continue; }

    const age = now - w.birth;

    // ── Score this frame ────────────────────────────────────────
    // 1. Geometry visibility: proxy via rotation angle openness.
    //    Wireframe looks most dramatic when face normals are ~45° to camera.
    //    sin²(rotation) gives two peaks per revolution; we take the envelope.
    const rx = w.mesh.rotation.x;
    const ry = w.mesh.rotation.y;
    const geoVis = 0.5 + 0.5 * Math.abs(Math.sin(rx * 2 + ry));  // 0.5–1.0

    // 2. Age envelope: rises sharply in first 1s, plateaus, fades at 6s.
    //    Piecewise: [0..0.8s] ramp, [0.8..5s] plateau, [5..8s] fade.
    let ageEnv;
    if (age < 800)        ageEnv = age / 800;
    else if (age < 5000)  ageEnv = 1.0;
    else                  ageEnv = Math.max(0, 1 - (age - 5000) / 3000);

    const geometryScore = geoVis * ageEnv;

    // 3. Chroma intensity: how much active bidder color is in the stack.
    const chromaIntensity = chromaStack.length > 0
      ? Math.min(1, chromaStack.reduce((acc, c) => {
          const a = (now - c.birth) / c.ttl;
          return acc + Math.pow(1 - a, 1.5);
        }, 0))
      : 0;

    // 4. Phase coherence: structured phases (spiral/web/stable) make richer images.
    const phaseScore = clamp(pw[2] * 0.4 + pw[3] * 0.7 + pw[4] * 1.0, 0, 1);

    const score = geometryScore * 0.50 + chromaIntensity * 0.30 + phaseScore * 0.20;

    // ── Peak detection ──────────────────────────────────────────
    // Track rolling peak
    if (score > w.peakScore) w.peakScore = score;

    const isPastMinWindow = age > w.MIN_WINDOW;
    const isTimedOut = age > w.MAX_WINDOW;

    // Require 3 consecutive frames of decline before calling it a peak.
    // This prevents a single-frame score wobble (like bid #9 at 0.14) from firing early.
    if (isPastMinWindow && score < w.lastScore * 0.97) {
      w.consecutiveDecays++;
    } else {
      w.consecutiveDecays = 0;
    }
    const isDecaying = w.consecutiveDecays >= 2;

    if (isPastMinWindow && (isDecaying || isTimedOut)) {
      w.peakFired = true;

      const reason = isTimedOut ? 'timeout' : 'peak-detected';
      console.log(`📸 Capture fired [${reason}] bid#${w.bidData.count} score=${w.peakScore.toFixed(3)} age=${(age/1000).toFixed(2)}s`);

      // SR auctions: only one bid can confirm per block (~12s on Ethereum).
      // The 100ms guard handles the rare case where our 8s polling cycle
      // reports two bids at once (network latency artifact, not true simultaneity).
      // (prevents two watchers firing on the exact same rendered frame).
      // Every bid MUST get a capture — no 2s gap, no skipping.
      const now2 = performance.now();
      if (now2 - lastCaptureTime >= 100) {
        lastCaptureTime = now2;
        sendCapture(captureFrame(), w.bidData, Math.max(w.peakScore, score));
      } else {
        // Same frame as previous capture — delay by 150ms so this bid
        // gets a slightly different frame. Still guaranteed to fire.
        const capturedBidData = w.bidData;
        const capturedPeakScore = Math.max(w.peakScore, score); // use best of peak or current
        setTimeout(() => {
          sendCapture(captureFrame(), capturedBidData, capturedPeakScore);
        }, 150);
      }

      peakWatchers.splice(i, 1);
      continue;
    }

    w.lastScore = score;
  }
}

/**
 * PRIMARY ENTRY POINT — called by bridge when a bid arrives.
 * bidData:  { count, address, amount, txHash, timestamp }
 * visual:   { geometryType, hue, sat, lit, phaseBoost }
 * position: THREE.Vector3 (current camera position)
 *
 * Does NOT schedule a capture. Instead, injectGeometry registers a bid pulse
 * and returns a proxy object. A PeakWatcher monitors every tick and fires
 * when visual luminance peaks and begins to fall.
 */
window.onBidReceived = function(bidData, visual, position) {
  const pos = position || (cosmicState ? cosmicState.pos : new THREE.Vector3());

  // 1. Push bidder's unique color onto the chroma stack
  const chromaColor = new THREE.Color().setHSL(visual.hue, visual.sat, visual.lit);
  bidderChromaStack.push({
    color: chromaColor,
    birth: performance.now(),
    ttl: 8000 // 8 second influence window
  });

  // 2. Advance cosmic phase based on accumulated bids
  externalPhaseBoost = Math.min(externalPhaseBoost + visual.phaseBoost, 0.45);

  // 3. Inject geometry (type based on bid amount) — returns the mesh
  const mesh = injectGeometry(visual.geometryType, pos, chromaColor);

  // 4. Register PeakWatcher — capture fires when agent detects visual peak
  registerPeakWatcher(mesh, bidData, chromaColor);
  console.log(`👁️ PeakWatcher registered for bid #${bidData.count}`);

  // 5. Update HUD
  updateHUD('bids', `${bidData.count} bid${bidData.count !== 1 ? 's' : ''}`);
  updateHUD('auction', `🔴 ${bidData.amount} ETH`);


};

// ── BID PULSE SYSTEM ─────────────────────────────────────────────────
// When a bid arrives, a radial brightness pulse expands through the
// existing particle field using the bidder's unique colour.
// No separate mesh — the effect is driven by uniforms in the particle
// shader, so it integrates seamlessly into the cosmos.
//
// Each pulse: born at bid time, expands radius 0→400 over 3.5s,
// brightness peaks at 0.5s then fades. Up to 3 simultaneous pulses.
const bidPulses = [];

function injectGeometry(type, position, color) {
  // Register a pulse — type is kept for PeakWatcher compatibility but
  // no mesh is created. The visual response is a particle brightness wave.
  const pulse = {
    color: color || new THREE.Color(1, 0.7, 0.1),
    birth: performance.now(),
    // Scale factor: torus (high bid) gets a stronger, wider pulse
    strength: type === 'torus' ? 1.0 : type === 'tetra' ? 0.75 : 0.55,
    // Use a dummy object so PeakWatcher can track rotation for scoring
    rotation: { x: 0, y: 0 }
  };
  bidPulses.push(pulse);
  if (bidPulses.length > 3) bidPulses.shift(); // keep max 3
  console.log('Bid pulse:', type, color ? color.getHexString() : 'default');

  // Return a proxy mesh-like object for PeakWatcher (needs .rotation)
  return pulse;
}

function updateAgentShapes() {
  // Rotate pulse proxies for PeakWatcher scoring (no scene objects to update)
  const now = performance.now();
  for (let i = bidPulses.length - 1; i >= 0; i--) {
    const p = bidPulses[i];
    p.rotation.x += 0.012;
    p.rotation.y += 0.009;
    if ((now - p.birth) > 8000) bidPulses.splice(i, 1);
  }
}

// Called from tick() — applies active pulses as uniforms to particle shader.
function applyBidPulses(t) {
  const now = performance.now();
  // Find the strongest active pulse to drive the shader
  let bestStr = 0, bestCol = null;
  for (const p of bidPulses) {
    const age = (now - p.birth) / 1000; // seconds
    if (age > 4) continue;
    // Envelope: ramp up 0→0.5s, hold 0.5→2s, fade 2→4s
    let env;
    if (age < 0.5)      env = age / 0.5;
    else if (age < 2.0) env = 1.0;
    else                env = Math.max(0, 1 - (age - 2.0) / 2.0);
    const str = env * p.strength;
    if (str > bestStr) { bestStr = str; bestCol = p.color; }
  }
  // Drive bidder chroma via the existing uniform system
  if (bestStr > 0 && bestCol) {
    pMat.uniforms.uBidChroma.value.copy(bestCol);
    pMat.uniforms.uBidChromaStr.value = bestStr * 0.5; // max 50% tint
  } else {
    pMat.uniforms.uBidChromaStr.value = Math.max(0, pMat.uniforms.uBidChromaStr.value - 0.02);
  }
}


window.addEventListener("load", () => {

const TOTAL_FRAMES=720, FPS=24;
const TAU=Math.PI*2, HALF_PI=Math.PI/2;
const TRAVEL=1800;
const W=3840, H=2160; // 4K UHD

const PALETTE=[
  new THREE.Color(0x2255ff), new THREE.Color(0x00ffff),
  new THREE.Color(0x00ffcc), new THREE.Color(0xffffff),
  new THREE.Color(0xff4400), new THREE.Color(0x00ff88),
  new THREE.Color(0xff00cc), new THREE.Color(0xffee44),
];
const NPAL=PALETTE.length;

function cycleCol(frame,period){
  const pos=(frame%period)/period*NPAL;
  const i0=Math.floor(pos)%NPAL, i1=(i0+1)%NPAL;
  const f=pos-Math.floor(pos), s=f*f*(3-2*f);
  const c=new THREE.Color(); c.lerpColors(PALETTE[i0],PALETTE[i1],s); return c;
}

// ═══════════════════════════════════════════════════════════════════
// CANVASES — master output, 3D layer, 2D flame layer, composite, bloom
// ═══════════════════════════════════════════════════════════════════
cOut=document.getElementById('cOut');
cOut.width=W; cOut.height=H;
const ctxOut=cOut.getContext('2d',{alpha:false});
ctxOut.imageSmoothingEnabled=false;

const c3d=document.createElement('canvas'); c3d.width=W; c3d.height=H;
const c2d=document.createElement('canvas'); c2d.width=W; c2d.height=H;
const ctx2=c2d.getContext('2d'); ctx2.imageSmoothingEnabled=false;
const cComp=document.createElement('canvas'); cComp.width=W; cComp.height=H;
const ctxC=cComp.getContext('2d',{alpha:true}); ctxC.imageSmoothingEnabled=false;
const cBloom=document.createElement('canvas');
cBloom.width=Math.round(W/4); cBloom.height=Math.round(H/4); // bloom at quarter-res
const ctxBloom=cBloom.getContext('2d'); ctxBloom.imageSmoothingEnabled=false;

// cSnap declared at top-level scope (see above window.load)

// ═══════════════════════════════════════════════════════════════════
// RENDERER — WebGL, ACES filmic tone mapping, HDR exposure
// ═══════════════════════════════════════════════════════════════════
const renderer=new THREE.WebGLRenderer({
  canvas:c3d, antialias:true, alpha:false,
  preserveDrawingBuffer:true,   // must be true to read c3d after render without tearing
  powerPreference:'high-performance',
  precision:'highp', stencil:false, depth:true
});
renderer.setSize(W,H,false);
// Force pixelRatio=1 — we manage resolution ourselves (cOut = 1920×1080).
// devicePixelRatio > 1 would render at 4K then downscale = wasted GPU + softer result.
renderer.setPixelRatio(1);
renderer.setClearColor(0x020100,1);
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
// Exposure: 1.65 gives rich HDR punch without blowing out the bright core.
// 2.20 was too hot — washed midtones and made captures look blurry/overexposed.
renderer.toneMappingExposure=1.65;

scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0x050200,0.00012); // reduced fog — sharper particle definition
const cam=new THREE.PerspectiveCamera(56,W/H,0.5,4000);

// ── Math ─────────────────────────────────────────────────────────────
// Math helpers — hash, modulo, trig shortcuts, tiling Z, smoothstep, lerp.
// clamp() is defined at top-level scope (before window.load) for use by
// the peak watcher system. These inner aliases are for use inside the loop.
function h(n){const x=Math.sin(n*127.1+311.7)*43758.5453; return x-Math.floor(x);}
function pm(a,b){return((a%b)+b)%b;}
const sL=(k,t,ph=0)=>Math.sin(TAU*k*t+ph);
const cL=(k,t,ph=0)=>Math.cos(TAU*k*t+ph);
const s01=(k,t,ph=0)=>(sL(k,t,ph)+1)*0.5;
function tz(oz,cz,S){return cz+pm(oz-cz+S*.5,S)-S*.5;}
// clamp() available from top-level scope — not redefined here
function ss(e0,e1,x){const t=clamp((x-e0)/(e1-e0),0,1);return t*t*(3-2*t);}
function lerp(a,b,t){return a+(b-a)*t;}

// ═══════════════════════════════════════════════════════════════════
// ENVELOPES — brightness, droste zoom, phase weights
// ═══════════════════════════════════════════════════════════════════
// ZOOM_RAMP: fraction of loop used for droste zoom-in/out transition at each end.
// 0.08 = 8% fade each end → animation is at full brightness for 84% of the loop.
// MIN_SCALE: how small the innermost droste layer gets (smaller = more recursion layers visible).
const ZOOM_RAMP=0.08, MIN_SCALE=0.060;
function drosteEnv(t){
  const tent=Math.min(Math.min(t,1-t)/ZOOM_RAMP,1);
  const zd=0.5-0.5*Math.cos(tent*Math.PI);
  return{scale:Math.pow(MIN_SCALE,1-zd),zd,vig:1-zd,fovB:(1-zd)*0.16};
}
// gFade: global brightness envelope for stars + particles.
// Clamped to minimum 0.55 so the scene is never fully dark even at loop transitions.
function gFade(t){
  const tent=Math.min(Math.min(t,1-t)/ZOOM_RAMP,1);
  return Math.max(0.75, ss(0,0.35,0.5-0.5*Math.cos(tent*Math.PI)));
}
// iFade: infinity flame envelope — allowed to fully fade for clean droste zoom.
function iFade(t){
  const tent=Math.min(Math.min(t,1-t)/ZOOM_RAMP,1);
  return ss(0,0.25,0.5-0.5*Math.cos(tent*Math.PI));
}

/**
 * MODIFIED phaseW — externalPhaseBoost shifts the phase curve forward.
 * More bids = animation evolves faster toward stable galaxy structure.
 * auctionSettled = locks into final phase.
 */
function phaseW(t){
  // Auction settle locks at stable phase
  if (auctionSettled) {
    const stableT = Math.min(t + 0.5, 0.95);
    return phaseWRaw(stableT);
  }
  return phaseWRaw(t + externalPhaseBoost);
}
function phaseWRaw(t){
  t = clamp(t, 0, 1);
  const fade=0.055;
  function band(lo,hi){return ss(lo,lo+fade,t)*ss(hi,hi-fade,t);}
  return[
    band(0.00,0.22)+(t>0.94?ss(0.94,1.0,t):0),
    band(0.18,0.44),band(0.38,0.64),band(0.58,0.84),band(0.78,1.00)
  ];
}

// externalPhaseBoost decays slowly back toward natural progression
function decayPhaseBoost() {
  if (externalPhaseBoost > 0) {
    externalPhaseBoost = Math.max(0, externalPhaseBoost - 0.00008);
  }
}

// ── Camera ───────────────────────────────────────────────────────────
const AX=24,AY=20,FX=2,FY=1;
function cBand(t,lo,hi,e=0.04){return ss(lo,lo+e,t)*ss(hi,hi-e,t);}
function baseFlight(t){return{
  pos:new THREE.Vector3(AX*sL(FX,t),AY*sL(FY,t,HALF_PI),-TRAVEL*t),
  fwd:new THREE.Vector3(AX*TAU*FX*cL(FX,t),AY*TAU*FY*cL(FY,t,HALF_PI),-TRAVEL).normalize(),
  up:new THREE.Vector3(0.06*sL(1,t,.5),1,0.04*cL(2,t)).normalize()
};}
function mBarrel(t,b){
  const ra=TAU*1.5*t,wu=new THREE.Vector3(0,1,0);
  const ri=new THREE.Vector3().crossVectors(b.fwd,wu).normalize();
  const ru=new THREE.Vector3().crossVectors(ri,b.fwd).normalize();
  const rol=new THREE.Vector3().addScaledVector(ru,Math.cos(ra)).addScaledVector(ri,Math.sin(ra));
  return{pos:b.pos.clone().add(new THREE.Vector3(70*Math.cos(TAU*t),70*Math.sin(TAU*t),0)),up:rol.normalize()};
}
function mSwoop(t,b){
  const el=120*Math.sin(Math.PI*sL(2,t,Math.PI*.5)*.5+0.8);
  const np=b.pos.clone().add(new THREE.Vector3(90*Math.cos(TAU*1.3*t),el,0));
  const nf=b.pos.clone().add(new THREE.Vector3(0,0,-180)).sub(np).normalize();
  const ta=el*0.008;
  return{pos:np,fwd:nf,up:new THREE.Vector3(Math.sin(ta),Math.cos(ta*.5),0).normalize()};
}
function mDutch(t,b){
  const ba=Math.PI*.38*sL(3,t,.7),ys=.55*sL(2,t,1.1);
  const wu=new THREE.Vector3(0,1,0),ri=new THREE.Vector3().crossVectors(b.fwd,wu).normalize();
  const bu=new THREE.Vector3().crossVectors(ri,b.fwd).normalize();
  const bup=new THREE.Vector3().addScaledVector(bu,Math.cos(ba)).addScaledVector(ri,Math.sin(ba));
  const yf=new THREE.Vector3().addScaledVector(b.fwd,Math.cos(ys)).addScaledVector(ri,Math.sin(ys)).normalize();
  const oa=TAU*.75*t;
  return{pos:b.pos.clone().add(new THREE.Vector3(95*Math.cos(oa),95*.4*Math.sin(oa*1.3),0)),fwd:yf,up:bup.normalize()};
}
function mOrbit(t,b){
  const ra=TAU*2*t;
  const np=b.pos.clone().add(new THREE.Vector3(110*Math.cos(ra),30*sL(3,t,.3),110*.45*Math.sin(ra)));
  const nf=b.pos.clone().add(new THREE.Vector3(0,0,-120)).sub(np).normalize();
  const tl=Math.sin(ra)*.4;
  return{pos:np,fwd:nf,up:new THREE.Vector3(Math.sin(tl),Math.cos(tl),0).normalize()};
}
function mUnder(t,b){
  const da=TAU*t;
  const np=b.pos.clone().add(new THREE.Vector3(60*Math.cos(TAU*1.7*t),130*Math.sin(da),0));
  const du=new THREE.Vector3().addScaledVector(new THREE.Vector3(0,1,0),Math.cos(da)).addScaledVector(new THREE.Vector3(0,0,1),Math.sin(da));
  return{pos:np,fwd:b.fwd,up:du.normalize()};
}
function mHelix(t,b){
  const hR=80,hT=2.5,ha=TAU*hT*t;
  const np=b.pos.clone().add(new THREE.Vector3(hR*Math.cos(ha),hR*Math.sin(ha)+60*Math.sin(TAU*t),0));
  const hf=new THREE.Vector3(-hR*TAU*hT*Math.sin(ha),hR*TAU*hT*Math.cos(ha),-TRAVEL).normalize();
  return{pos:np,fwd:hf,up:new THREE.Vector3().crossVectors(hf,new THREE.Vector3(-Math.cos(ha),-Math.sin(ha),0)).normalize()};
}
function camState(t){
  const b=baseFlight(t);
  const w1=cBand(t,.13,.31,.05),w2=cBand(t,.29,.46,.05),w3=cBand(t,.44,.59,.05);
  const w4=cBand(t,.57,.73,.05),w5=cBand(t,.71,.86,.05),w6=cBand(t,.84,.99,.05);
  const wb=Math.max(0,1-w1-w2-w3-w4-w5-w6);
  const m1=mBarrel(t,b),m2=mSwoop(t,b),m3=mDutch(t,b);
  const m4=mOrbit(t,b),m5=mUnder(t,b),m6=mHelix(t,b);
  const pos=new THREE.Vector3()
    .addScaledVector(b.pos,wb).addScaledVector(m1.pos||b.pos,w1)
    .addScaledVector(m2.pos,w2).addScaledVector(m3.pos,w3)
    .addScaledVector(m4.pos,w4).addScaledVector(m5.pos,w5).addScaledVector(m6.pos,w6);
  const fwd=new THREE.Vector3()
    .addScaledVector(b.fwd,wb+w1+w5).addScaledVector(m2.fwd,w2)
    .addScaledVector(m3.fwd,w3).addScaledVector(m4.fwd,w4).addScaledVector(m6.fwd,w6).normalize();
  const up=new THREE.Vector3()
    .addScaledVector(b.up,wb).addScaledVector(m1.up,w1).addScaledVector(m2.up,w2)
    .addScaledVector(m3.up,w3).addScaledVector(m4.up,w4).addScaledVector(m5.up,w5)
    .addScaledVector(m6.up,w6).normalize();
  return{pos,fwd,up};
}
function applyCamera(t){
  const{pos,fwd,up}=camState(t);
  const r=new THREE.Vector3().crossVectors(fwd,up).normalize();
  const tu=new THREE.Vector3().crossVectors(r,fwd).normalize();
  cam.position.copy(pos);
  cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r,tu,fwd.clone().negate()));
}
function getPos(t){return camState(t).pos;}
function getFwd(t){return camState(t).fwd;}
function getUp(t){return camState(t).up;}

// ═══════════════════════════════════════════════════════════════════
//  STARS
// ═══════════════════════════════════════════════════════════════════
const SS=1800;
const sVert=`
  attribute float aSize;
  attribute float aBri;
  uniform float uGF;
  varying float vBri;
  void main(){
    vBri=aBri*uGF;
    vec4 mv=modelViewMatrix*vec4(position,1.0);
    gl_PointSize=aSize/(1.0+(-mv.z)*0.00030)*2.0; // 4K: 2x scale
    gl_Position=projectionMatrix*mv;
  }`;
const sFragFull=`
  uniform vec3 uColor;
  varying float vBri;
  float ss2(float a,float b,float x){float t=clamp((x-a)/(b-a),0.0,1.0);return t*t*(3.0-2.0*t);}
  void main(){
    vec2 uv=gl_PointCoord*2.0-1.0;
    float r=length(uv);
    if(r>1.0)discard;
    float gauss=exp(-r*r/0.08);
    float spike=(exp(-abs(uv.x)*12.0)*exp(-uv.y*uv.y*22.0)
                +exp(-abs(uv.y)*12.0)*exp(-uv.x*uv.x*22.0))*0.25;
    float halo=clamp((0.75-r)/(0.75-0.25),0.0,1.0); halo=halo*halo*(3.0-2.0*halo)*0.08;
    float lum=clamp(gauss+spike+halo,0.0,1.0);
    gl_FragColor=vec4(uColor*(0.85+gauss*0.95),lum*vBri);
  }`;

function mkStar(n,r0,r1,szMin,szMax,col,sd,spd){
  const pos=new Float32Array(n*3),sz=new Float32Array(n),bri=new Float32Array(n);
  for(let i=0;i<n;i++){
    const phi=Math.acos(1-2*h(sd+i*2.1)),th=h(sd+i*3.7)*TAU;
    const r=r0+Math.pow(h(sd+i*5.3),.55)*(r1-r0);
    pos[i*3]=r*Math.sin(phi)*Math.cos(th);
    pos[i*3+1]=r*Math.sin(phi)*Math.sin(th);
    pos[i*3+2]=(h(sd+i*13.7)-.5)*SS;
    sz[i]=szMin+Math.pow(h(sd+i*7.1),1.8)*(szMax-szMin);
    bri[i]=0.42+h(sd+i*11.3)*0.58;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));
  g.setAttribute('aSize',new THREE.BufferAttribute(sz,1));
  g.setAttribute('aBri',new THREE.BufferAttribute(bri,1));
  const mat=new THREE.ShaderMaterial({
    uniforms:{uColor:{value:new THREE.Color(col)},uGF:{value:1.0}},
    vertexShader:sVert,fragmentShader:sFragFull,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending
  });
  const m=new THREE.Points(g,mat);
  m.frustumCulled=false;
  m.userData={o:pos,n,spd};
  return m;
}
// Star counts doubled for 4K density. Size ranges scaled up proportionally.
const SL=[
  mkStar(9000,40,520,2.2,6.5,0xfff4e0,11,0.002),   // main field — doubled
  mkStar(4500,12,200,3.5,9.0,0xffd580,22,0.0008),   // mid field
  mkStar(2500,4,90, 5.0,13.0,0xfffbe8,33,0.001),    // bright foreground
  mkStar(6000,180,650,1.8,4.8,0xffcc44,44,0.0002),  // distant haze
  mkStar(1600,6,60, 6.0,16.0,0xaaddff,7,0.003),     // blue accent stars
];
SL.forEach(l=>scene.add(l));

function tileStar(cz,t,gf,frame){
  // Stars stay warm gold — bidder chroma only affects particles, not stars.
  // Colour cycles gently through the warm palette for ambient variation.
  // Stars cycle through warm amber/gold only — never cold colours.
  const stT = (frame % 240) / 240;
  const stHue = 0.07 + Math.sin(stT * Math.PI * 2) * 0.03; // 0.04–0.10 = deep amber to gold
  const sc = new THREE.Color().setHSL(stHue, 0.90, 0.65);
  SL.forEach(l=>{
    const{o,n,spd}=l.userData,a=l.geometry.attributes.position.array;
    const px=spd*sL(1,t)*180,py=spd*sL(2,t,TAU*.175)*180;
    for(let i=0;i<n;i++){a[i*3]=o[i*3]+px;a[i*3+1]=o[i*3+1]+py;a[i*3+2]=tz(o[i*3+2],cz,SS);}
    l.geometry.attributes.position.needsUpdate=true;
    l.material.uniforms.uColor.value.copy(sc);
    l.material.uniforms.uGF.value=Math.max(0.82, (0.92+sL(2,t,spd*37)*0.08)*gf);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  PARTICLES
// ═══════════════════════════════════════════════════════════════════
const NP=26000,SLAB_P=1800;

const chaos=new Float32Array(NP*3);
for(let i=0;i<NP;i++){
  const phi=Math.acos(1-2*h(i*2.3+1)),th=h(i*3.7+1)*TAU;
  const r=30+Math.pow(h(i*5.1+1),.38)*340;
  chaos[i*3]=r*Math.sin(phi)*Math.cos(th);
  chaos[i*3+1]=r*Math.sin(phi)*Math.sin(th);
  chaos[i*3+2]=(h(i*13.1+1)-.5)*SLAB_P;
}
const CLUSTER_N=7,clCx=[],clCy=[],clCz=[];
for(let c=0;c<CLUSTER_N;c++){clCx.push((h(c*31+5)-.5)*260);clCy.push((h(c*37+5)-.5)*260);clCz.push((h(c*41+5)-.5)*SLAB_P);}
const clustered=new Float32Array(NP*3);
for(let i=0;i<NP;i++){
  const ci=Math.floor(h(i*7.1+2)*CLUSTER_N),r=3+Math.pow(h(i*11.3+2),.5)*85;
  const phi=Math.acos(1-2*h(i*13.7+2)),th=h(i*17.1+2)*TAU;
  clustered[i*3]=clCx[ci]+r*Math.sin(phi)*Math.cos(th);
  clustered[i*3+1]=clCy[ci]+r*Math.sin(phi)*Math.sin(th);
  clustered[i*3+2]=tz(clCz[ci],0,SLAB_P)+(h(i*19.3+2)-.5)*55;
}
const GAL_N=7,galCx=[],galCy=[],galCz=[];
for(let g=0;g<GAL_N;g++){
  galCx.push((h(g*43+9)-.5)*330);galCy.push((h(g*47+9)-.5)*330);galCz.push((h(g*53+9)-.5)*SLAB_P);
}
const spiral=new Float32Array(NP*3);
for(let i=0;i<NP;i++){
  const gi=Math.floor(h(i*3.3+3)*GAL_N),v=h(i*7.7+3),armID=Math.floor(h(i*11.3+3)*3);
  const r=2+Math.pow(v,.52)*115,ao=(armID/3)*TAU,ag=ao+v*TAU*1.75+(h(i*13.1+3)-.5)*.48;
  const sc=(1-v*.62)*7+2;
  spiral[i*3]=galCx[gi]+Math.cos(ag)*r+(h(i*17.3+3)-.5)*sc;
  spiral[i*3+1]=galCy[gi]+Math.sin(ag)*r+(h(i*19.7+3)-.5)*sc;
  spiral[i*3+2]=tz(galCz[gi],0,SLAB_P)+(h(i*23.1+3)-.5)*14*(1-v);
}
const web=new Float32Array(NP*3);
for(let i=0;i<NP;i++){
  const gi=Math.floor(h(i*2.7+4)*GAL_N),gi2=(gi+1+Math.floor(h(i*5.3+4)*(GAL_N-1)))%GAL_N;
  const bl=h(i*7.1+4),spread=3+h(i*11.1+4)*26;
  const fx=lerp(galCx[gi],galCx[gi2],bl),fy=lerp(galCy[gi],galCy[gi2],bl);
  const fz=tz(lerp(galCz[gi],galCz[gi2],bl),0,SLAB_P);
  const phi=Math.acos(1-2*h(i*13.3+4)),th=h(i*17.9+4)*TAU;
  web[i*3]=fx+Math.sin(phi)*Math.cos(th)*spread;
  web[i*3+1]=fy+Math.sin(phi)*Math.sin(th)*spread;
  web[i*3+2]=fz+(h(i*19.3+4)-.5)*spread;
}
const stable=new Float32Array(NP*3);
for(let i=0;i<NP;i++){
  const gi=Math.floor(h(i*3.3+5)*GAL_N),v=Math.pow(h(i*7.7+5),.65),armID=Math.floor(h(i*11.3+5)*3);
  const r=1+v*100,ao=(armID/3)*TAU,ag=ao+v*TAU*1.85+(h(i*13.1+5)-.5)*.32;
  const sc=(1-v*.68)*6+1.5;
  stable[i*3]=galCx[gi]+Math.cos(ag)*r+(h(i*17.3+5)-.5)*sc;
  stable[i*3+1]=galCy[gi]+Math.sin(ag)*r+(h(i*19.7+5)-.5)*sc;
  stable[i*3+2]=tz(galCz[gi],0,SLAB_P)+(h(i*23.1+5)-.5)*12*(1-v);
}
// Particle base colors:
// aC0 = chaos/cluster phase — warm amber-gold, clearly visible on black.
//        Was 0.14-0.26 (nearly invisible). Now 0.55-0.80 golden range.
// aC1 = spiral/web/stable phase — hot white-orange (unchanged, already bright).
const aC0=new Float32Array(NP*3),aC1=new Float32Array(NP*3);
for(let i=0;i<NP;i++){
  const c=h(i*3.3+6),v=h(i*7.7+3);
  // Warm amber-gold base — bright enough to sparkle on black at all phases.
  // Raised from 0.62 to 0.72 so background particles are clearly visible.
  aC0[i*3]  = 0.72 + c*0.18;   // R: 0.72–0.90
  aC0[i*3+1]= 0.50 + c*0.14;   // G: 0.50–0.64
  aC0[i*3+2]= 0.04 + c*0.08;   // B: 0.04–0.12
  const ch=clamp(1-v*1.4,0,1);
  aC1[i*3]  = 0.95+ch*0.05;
  aC1[i*3+1]= 0.68+ch*0.22-c*0.05;
  aC1[i*3+2]= 0.05+ch*0.18;
}
const pSz=new Float32Array(NP);
for(let i=0;i<NP;i++) pSz[i]=0.55+Math.pow(h(i*5.3+7),2.4)*5.2;

const pGeo=new THREE.BufferGeometry();
const pPos=new Float32Array(NP*3);
pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));
pGeo.setAttribute('aColor0',new THREE.BufferAttribute(aC0,3));
pGeo.setAttribute('aColor1',new THREE.BufferAttribute(aC1,3));
pGeo.setAttribute('aSize',new THREE.BufferAttribute(pSz,1));

pMat=new THREE.ShaderMaterial({
  uniforms:{
    uPB:{value:0},   // phase blend: 0=chaos colours, 1=stable colours
    uGF:{value:1},   // global brightness fade
    uT:{value:0},    // time (0-1) for shimmer
    uBidChroma:{value:new THREE.Color(1,1,1)},   // active bidder hue
    uBidChromaStr:{value:0}                       // pulse strength 0-0.5
  },
  vertexShader:`
    attribute vec3 aColor0,aColor1; attribute float aSize;
    varying vec3 vC; varying float vA;
    uniform float uPB,uGF,uT,uBidChromaStr;
    uniform vec3 uBidChroma;
    void main(){
      // Use baked aC0/aC1 colours directly — no tint multiplication.
      // aC0=warm amber (chaos/cluster), aC1=hot white-orange (spiral/web/stable).
      vec3 col=mix(aColor0,aColor1,uPB);
      // Bidder chroma: subtle additive tint from active bid's wallet hue.
      col=mix(col, col*uBidChroma*1.2, uBidChromaStr*0.40);
      vC=col;
      // sh: per-particle shimmer. Floor raised from 0.72 to 0.82
      // so minimum alpha at gFade floor = 0.82 * 0.55 = 0.45 — clearly visible.
      float sh=0.82+0.18*sin(6.2831*(uT+position.x*.0071+position.y*.0059));
      vA=sh*uGF;
      vec4 mv=modelViewMatrix*vec4(position,1.0);
      gl_PointSize=aSize/(1.0+(-mv.z)*0.00036)*4.2; // 4K scale
      gl_Position=projectionMatrix*mv;
    }`,
  fragmentShader:`
    varying vec3 vC; varying float vA;
    void main(){
      vec2 uv=gl_PointCoord*2.0-1.0;
      float r=dot(uv,uv);
      if(r>1.0)discard;
      float core=exp(-r/0.12);
      float spike=exp(-r/0.018)*0.55;
      float glow=1.0-smoothstep(0.0,1.0,r);
      // Base brightness raised: 0.75→0.92. Core glow: 1.05→1.35. Particles pop on black.
      vec3 col=clamp(vC,0.0,1.0)*(0.92+core*1.35+spike);
      float alpha=clamp((core*0.95+spike+glow*0.38)*vA,0.0,1.0);
      gl_FragColor=vec4(col,alpha);
    }`,
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending
});
const pMesh=new THREE.Points(pGeo,pMat);
pMesh.frustumCulled=false; scene.add(pMesh);

// Web lines
const WL=120,wlGeo=new THREE.BufferGeometry();
wlGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(WL*6),3));
const wlMat=new THREE.LineBasicMaterial({color:0xffaa22,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
const wlMesh=new THREE.LineSegments(wlGeo,wlMat);
wlMesh.frustumCulled=false; scene.add(wlMesh);
const wlEP=[];
for(let i=0;i<WL;i++){
  const a=Math.floor(h(i*7.1+10)*GAL_N),b=(a+1+Math.floor(h(i*11.3+10)*(GAL_N-1)))%GAL_N;
  wlEP.push({a,b});
}

// Core glows
const glowCv=document.createElement('canvas'); glowCv.width=glowCv.height=256;
(()=>{const g=glowCv.getContext('2d'),r=g.createRadialGradient(128,128,0,128,128,128);
  r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.04,'rgba(255,240,180,1)');
  r.addColorStop(.12,'rgba(255,200,60,.92)');r.addColorStop(.30,'rgba(220,130,15,.55)');
  r.addColorStop(.60,'rgba(160,70,3,.22)');r.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=r;g.fillRect(0,0,256,256);
})();
const glowTex=new THREE.CanvasTexture(glowCv);
const coreGlows=[];
for(let i=0;i<GAL_N;i++){
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xffffaa,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
  sp.frustumCulled=false; scene.add(sp); coreGlows.push(sp);
}

// ── Nebula Wisps ─────────────────────────────────────────────────────
const WISP_COUNT=16;
const wV=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const wF=`varying vec2 vUv;
uniform float s1,c1,s2,c2,bri,opa;uniform vec3 col;
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float ns(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*ns(p);p=p*2.1+vec2(1.7,9.2);a*=.52;}return v;}
void main(){
  vec2 uv=vUv*2.-1.;float d=length(uv);
  float n=fbm(uv*2.2+vec2(s1,c1)*.18),n2=fbm(uv*1.4+vec2(c2,s2)*.10);
  float alpha=smoothstep(1.,.02,d)*pow(n,1.30)*.55*opa;
  float lum=mix(bri*.22,bri*1.45,n);lum=mix(lum,1.,n2*.32);
  gl_FragColor=vec4(vec3(lum)*mix(col,vec3(1.,.84,.32),n2*.45),alpha);}`;
const wisps=[];
for(let i=0;i<WISP_COUNT;i++){
  const mat=new THREE.ShaderMaterial({
    uniforms:{s1:{value:0},c1:{value:1},s2:{value:0},c2:{value:1},bri:{value:.55+h(i*17)*.65},opa:{value:0},col:{value:new THREE.Color().setHSL(.07+h(i*11)*.08,.90,.62)}},
    vertexShader:wV,fragmentShader:wF,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide
  });
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(100+h(i*13)*160,100+h(i*19)*160),mat);
  mesh.frustumCulled=false;
  mesh.userData={fx:1+Math.floor(h(i*3.7)*2),fy:1+Math.floor(h(i*5.1)*2),ax:55+h(i*11)*120,ay:55+h(i*13)*120,bz:pm(h(i*23)*SLAB_P,SLAB_P)-SLAB_P*.5,px:h(i*29)*TAU,py:h(i*31)*TAU,mat,baseBri:.55+h(i*17)*.65};
  scene.add(mesh); wisps.push(mesh);
}

// ═══════════════════════════════════════════════════════════════════
//  INFINITY FLAME
// ═══════════════════════════════════════════════════════════════════
const INF_A=W*0.155,INF_CX=W*.5,INF_CY=H*.5,INF_SEGS=720;
function lemPt(theta,scale,cx,cy){
  const s=Math.sin(theta),c=Math.cos(theta),d=1+s*s;
  return{x:cx+scale*INF_A*c/d,y:cy+scale*INF_A*s*c/d};
}
const FLAME_N=1800;
const fPh=new Float32Array(FLAME_N),fSd=new Float32Array(FLAME_N);
const fSpd=new Float32Array(FLAME_N),fOff=new Float32Array(FLAME_N);
for(let i=0;i<FLAME_N;i++){
  fPh[i]=h(i*3.7+100);fSd[i]=h(i*7.1+200);
  fSpd[i]=.4+h(i*11.3+300)*1.2;fOff[i]=h(i*13.7+400);
}

function drawInfinity(ctx,t,fade,scale,cx,cy,aScale){
  if(fade<0.003||aScale<0.003)return;
  const aS=aScale*fade;

  const hR=INF_A*scale*1.45*(1+sL(1,t)*.04);
  const hg=ctx.createRadialGradient(cx,cy,0,cx,cy,hR);
  hg.addColorStop(0,`rgba(255,190,50,${(.09*aS).toFixed(3)})`);
  hg.addColorStop(.4,`rgba(200,80,10,${(.05*aS).toFixed(3)})`);
  hg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=hg; ctx.fillRect(cx-hR,cy-hR,hR*2,hR*2);

  const pS=scale*(1+sL(2,t)*.022+sL(3,t)*.010);
  const yQ=1+sL(1,t)*.035;
  const pts=[];
  for(let i=0;i<=INF_SEGS;i++){
    const p=lemPt(i/INF_SEGS*TAU,pS,cx,cy);
    pts.push({x:p.x,y:cy+(p.y-cy)*yQ});
  }

  [{w:28,a:.012,c:'255,120,0'},{w:14,a:.030,c:'255,155,0'},{w:7,a:.07,c:'255,210,30'},
   {w:3,a:.16,c:'255,235,90'},{w:1.2,a:.40,c:'255,248,170'},{w:.55,a:.82,c:'255,255,245'}
  ].forEach(({w,a,c})=>{
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<=INF_SEGS;i++) ctx.lineTo(pts[i].x,pts[i].y);
    ctx.closePath();
    ctx.strokeStyle=`rgba(${c},${(a*aS).toFixed(3)})`;
    ctx.lineWidth=w*scale; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.stroke();
  });

  for(let i=0;i<80;i++){
    const i0=Math.floor(i/80*INF_SEGS),i1=Math.floor((i+1)/80*INF_SEGS);
    const p0=pts[i0],p1=pts[i1];
    const hp=sL(1,t,(i/80)*TAU*2)*.5+.5;
    ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y);
    ctx.strokeStyle=`rgba(255,${Math.round(185+60*hp)},${Math.round(15+35*hp)},${(.92*aS).toFixed(3)})`;
    ctx.lineWidth=1.8*scale; ctx.stroke();
  }

  for(let i=0;i<FLAME_N;i++){
    const iSp=1+Math.floor(fSpd[i]*2.99);
    const pp=pm(fPh[i]+sL(iSp,t,fSd[i]*TAU)*.5+t*iSp*.08,1);
    const pi=Math.floor(pp*INF_SEGS);
    const bp=pts[pi]; if(!bp)continue;
    const pi2=(pi+2)%INF_SEGS;
    const dx=pts[pi2].x-bp.x,dy=pts[pi2].y-bp.y;
    const len=Math.sqrt(dx*dx+dy*dy)+.001;
    const nx=-dy/len,ny=dx/len;
    const fh=(4+fOff[i]*18)*scale*(1+sL(2,t,fSd[i]*TAU)*.4);
    const flk=.4+.6*s01(3+(fSd[i]>.5?1:0),t,fSd[i]*TAU);
    const heat=1-fOff[i];
    const al=clamp(flk*aS*(.22+heat*.56),0,1);
    const hot=Math.pow(heat,.6);
    ctx.beginPath();
    ctx.arc(bp.x+nx*fh,bp.y+ny*fh,(.75+fOff[i]*1.8)*scale,0,TAU);
    ctx.fillStyle=`rgba(255,${Math.round(150+100*hot)},${Math.round(hot*80)},${al.toFixed(3)})`;
    ctx.fill();
  }

  const kR=(10+sL(3,t)*1.8)*scale;
  const kg=ctx.createRadialGradient(cx,cy,0,cx,cy,kR*4);
  kg.addColorStop(0,`rgba(255,255,255,${(.99*aS).toFixed(3)})`);
  kg.addColorStop(.08,`rgba(255,255,220,${(.97*aS).toFixed(3)})`);
  kg.addColorStop(.25,`rgba(255,230,90,${(.82*aS).toFixed(3)})`);
  kg.addColorStop(.55,`rgba(220,110,10,${(.38*aS).toFixed(3)})`);
  kg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(cx,cy,kR*4,0,TAU); ctx.fillStyle=kg; ctx.fill();

  [[t*3,.5],[t*3+.5,.5]].forEach(([base,amp],si)=>{
    const sp=pm(sL(3,t)*amp+amp+base,1);
    const idx=Math.floor(sp*INF_SEGS);
    const spt=pts[idx]; if(!spt)return;
    const sr=si===0?26:18,sa=si===0?.98:.90;
    const sg=ctx.createRadialGradient(spt.x,spt.y,0,spt.x,spt.y,sr*scale);
    sg.addColorStop(0,`rgba(255,255,255,${(sa*aS).toFixed(3)})`);
    sg.addColorStop(.15,`rgba(255,245,120,${(sa*.80*aS).toFixed(3)})`);
    sg.addColorStop(.50,`rgba(255,180,30,${(sa*.40*aS).toFixed(3)})`);
    sg.addColorStop(1,'rgba(200,80,0,0)');
    ctx.beginPath(); ctx.arc(spt.x,spt.y,sr*scale,0,TAU); ctx.fillStyle=sg; ctx.fill();
  });
}

// ═══════════════════════════════════════════════════════════════════
// BLOOM — multi-pass screen-blend glow over composite canvas
// ═══════════════════════════════════════════════════════════════════
const BW=cBloom.width,BH=cBloom.height;
// Bloom: 5 passes at 0.9px spread = tight crisp halos, not smear.
// STR=0.22 adds glow without washing out midtones.
const BLOOM_PASSES=5, BLOOM_SPREAD=0.9, BLOOM_STR=0.22;
function applyBloom(){
  ctxBloom.clearRect(0,0,BW,BH);
  ctxBloom.globalAlpha=1;
  ctxBloom.globalCompositeOperation='source-over';
  ctxBloom.drawImage(cComp,0,0,BW,BH);
  ctxBloom.globalCompositeOperation='screen';
  ctxBloom.globalAlpha=0.50/BLOOM_PASSES;
  for(let p=0;p<BLOOM_PASSES;p++){
    const angle=(p/BLOOM_PASSES)*TAU;
    const ox=Math.cos(angle)*BLOOM_SPREAD,oy=Math.sin(angle)*BLOOM_SPREAD;
    ctxBloom.drawImage(cBloom,ox,oy,BW,BH);
    ctxBloom.drawImage(cBloom,-ox,-oy,BW,BH);
  }
  ctxBloom.globalCompositeOperation='source-over';
  ctxBloom.globalAlpha=1;
}

// ═══════════════════════════════════════════════════════════════════
// COMPOSITE — droste layers + bloom overlay + vignette + lens flare
// ═══════════════════════════════════════════════════════════════════
const DROSTE_LAYERS=8;
function compositeFrame(t,droste){
  const iF=iFade(t),S=droste.scale;

  ctx2.clearRect(0,0,W,H);
  drawInfinity(ctx2,t,iF,1+(1-S)*.35,INF_CX,INF_CY,1);

  ctxC.clearRect(0,0,W,H);
  ctxC.imageSmoothingEnabled=false;  // no banding from sub-pixel interpolation
  ctxC.drawImage(c3d,0,0);
  ctxC.globalCompositeOperation='lighter';
  ctxC.drawImage(c2d,0,0);
  ctxC.globalCompositeOperation='source-over';

  applyBloom();

  ctxOut.fillStyle='#020100';
  ctxOut.fillRect(0,0,W,H);

  const layerFade=-Math.log(S+1e-9)*.55;
  // Only use smooth interpolation during the zoom transition (S < 0.5).
  // At normal viewing (S close to 1.0), pixelated gives sharper results.
  const isZooming = S < 0.5;
  ctxOut.imageSmoothingEnabled = isZooming;
  if (isZooming) ctxOut.imageSmoothingQuality='high';
  for(let layer=0;layer<=DROSTE_LAYERS;layer++){
    const lS=Math.pow(S,layer);
    if(lS<0.006)break;
    const dw=W*lS,dh=H*lS;
    const dx=INF_CX-dw*.5,dy=INF_CY-dh*.5;
    ctxOut.globalAlpha=clamp(Math.exp(-layer*layerFade*.7),0,1);
    ctxOut.drawImage(cComp,dx,dy,dw,dh);
  }
  ctxOut.globalAlpha=1;

  ctxOut.imageSmoothingEnabled=false;
  ctxOut.globalCompositeOperation='screen';
  ctxOut.globalAlpha=BLOOM_STR;
  ctxOut.drawImage(cBloom,0,0,W,H);
  ctxOut.globalCompositeOperation='source-over';
  ctxOut.globalAlpha=1;

  const vigAmt=droste.vig*.75;
  if(vigAmt>.003){
    const vR=Math.min(W,H)*.75;
    const vg=ctxOut.createRadialGradient(INF_CX,INF_CY,vR*droste.scale*.5,INF_CX,INF_CY,vR);
    vg.addColorStop(0,'rgba(0,0,0,0)');
    vg.addColorStop(1,`rgba(2,1,0,${vigAmt.toFixed(3)})`);
    ctxOut.fillStyle=vg; ctxOut.fillRect(0,0,W,H);
  }

  const fStr=droste.vig*.42;
  if(fStr>.003){
    const fl=W*.24*droste.vig;
    const fg=ctxOut.createLinearGradient(INF_CX-fl,INF_CY,INF_CX+fl,INF_CY);
    fg.addColorStop(0,'rgba(255,210,60,0)');
    fg.addColorStop(.5,`rgba(255,245,160,${fStr.toFixed(3)})`);
    fg.addColorStop(1,'rgba(255,210,60,0)');
    ctxOut.fillStyle=fg; ctxOut.fillRect(INF_CX-fl,INF_CY-4,fl*2,8);
    const fg2=ctxOut.createLinearGradient(INF_CX,INF_CY-fl*.42,INF_CX,INF_CY+fl*.42);
    fg2.addColorStop(0,'rgba(255,210,60,0)');
    fg2.addColorStop(.5,`rgba(255,245,160,${(fStr*.50).toFixed(3)})`);
    fg2.addColorStop(1,'rgba(255,210,60,0)');
    ctxOut.fillStyle=fg2; ctxOut.fillRect(INF_CX-2,INF_CY-fl*.42,4,fl*.84);
    const fc=ctxOut.createLinearGradient(INF_CX-fl*1.1,INF_CY,INF_CX+fl*1.1,INF_CY);
    fc.addColorStop(0,'rgba(0,200,255,0)');
    fc.addColorStop(.49,`rgba(0,200,255,${(fStr*.08).toFixed(3)})`);
    fc.addColorStop(.51,`rgba(0,200,255,${(fStr*.08).toFixed(3)})`);
    fc.addColorStop(1,'rgba(0,200,255,0)');
    ctxOut.fillStyle=fc; ctxOut.fillRect(INF_CX-fl*1.1,INF_CY-2,fl*2.2,4);
  }

  // Write completed frame into cSnap (2D→2D copy, instant, no GPU stall).
  // captureFrame() reads from cSnap — never from the WebGL or display canvas.
  ctxSnap.drawImage(cComp,0,0,2560,1440);
}

// ── 3D helpers ────────────────────────────────────────────────────────
function updateParticles(t,cz,pw){
  const[w1,w2,w3,w4,w5]=pw,wS=w1+w2+w3+w4+w5+1e-5;
  const[n1,n2,n3,n4,n5]=[w1/wS,w2/wS,w3/wS,w4/wS,w5/wS];
  const ang=TAU*2*t,cs=Math.cos(ang),sn=Math.sin(ang);
  const br=1+sL(1,t)*.022,dx=sL(1,t)*6,dy2=cL(1,t)*6;
  for(let i=0;i<NP;i++){
    const chX=chaos[i*3]+sL(2,t,i*.00028)*2.5,chY=chaos[i*3+1]+cL(2,t,i*.00023)*2.5,chZ=tz(chaos[i*3+2],cz,SLAB_P);
    const clX=clustered[i*3]+sL(1,t,h(i*3.1)*TAU)*1.5,clY=clustered[i*3+1]+cL(1,t,h(i*5.3)*TAU)*1.5,clZ=tz(clustered[i*3+2],cz,SLAB_P);
    const gi3=Math.floor(h(i*3.3+3)*GAL_N),lx3=spiral[i*3]-galCx[gi3],ly3=spiral[i*3+1]-galCy[gi3];
    const spX=(galCx[gi3]+lx3*cs-ly3*sn)*br+dx,spY=(galCy[gi3]+lx3*sn+ly3*cs)*br+dy2,spZ=tz(spiral[i*3+2],cz,SLAB_P);
    const gi4=Math.floor(h(i*2.7+4)*GAL_N),gi4b=(gi4+1+Math.floor(h(i*5.3+4)*(GAL_N-1)))%GAL_N,bl=h(i*7.1+4);
    const wbX=web[i*3]+(lerp(galCx[gi4],galCx[gi4b],bl)*(br-1))+dx*.5;
    const wbY=web[i*3+1]+(lerp(galCy[gi4],galCy[gi4b],bl)*(br-1))+dy2*.5,wbZ=tz(web[i*3+2],cz,SLAB_P);
    const gi5=Math.floor(h(i*3.3+5)*GAL_N),lx5=stable[i*3]-galCx[gi5],ly5=stable[i*3+1]-galCy[gi5];
    const stX=(galCx[gi5]+lx5*cs-ly5*sn)*br+dx,stY=(galCy[gi5]+lx5*sn+ly5*cs)*br+dy2,stZ=tz(stable[i*3+2],cz,SLAB_P);
    pPos[i*3]=chX*n1+clX*n2+spX*n3+wbX*n4+stX*n5;
    pPos[i*3+1]=chY*n1+clY*n2+spY*n3+wbY*n4+stY*n5;
    pPos[i*3+2]=chZ*n1+clZ*n2+spZ*n3+wbZ*n4+stZ*n5;
  }
  pGeo.attributes.position.needsUpdate=true;
}
function updateWebLines(t,cz,wW,gf,frame){
  const br=1+sL(1,t)*.022,dx=sL(1,t)*6,dy2=cL(1,t)*6;
  const arr=wlGeo.attributes.position.array;
  for(let i=0;i<WL;i++){
    const{a,b}=wlEP[i];
    arr[i*6]=galCx[a]*br+dx; arr[i*6+1]=galCy[a]*br+dy2; arr[i*6+2]=tz(galCz[a],cz,SLAB_P);
    arr[i*6+3]=galCx[b]*br+dx; arr[i*6+4]=galCy[b]*br+dy2; arr[i*6+5]=tz(galCz[b],cz,SLAB_P);
  }
  wlGeo.attributes.position.needsUpdate=true;
  // Web lines stay warm — cycle through gold/amber only, never blues or magentas.
  const wlT = (frame % 180) / 180;
  const wlHue = 0.08 + Math.sin(wlT * Math.PI * 2) * 0.04; // 0.04–0.12 = amber to yellow-gold
  wlMat.color.setHSL(wlHue, 0.95, 0.62);
  wlMat.opacity=clamp(wW*(.09+sL(2,t)*.035)*gf,0,.22);
}
function updateCoreGlows(t,cz,pw,gf){
  const gv=clamp(pw[2]+pw[3]+pw[4],0,1);
  const br=1+sL(1,t)*.022,dx=sL(1,t)*6,dy2=cL(1,t)*6;
  for(let i=0;i<GAL_N;i++){
    const p=1+sL(1,t,h(i*7)*TAU)*.28;
    coreGlows[i].position.set(galCx[i]*br+dx,galCy[i]*br+dy2,tz(galCz[i],cz,SLAB_P));
    coreGlows[i].scale.setScalar((75+sL(1,t,h(i*11)*TAU)*24)*p);
    coreGlows[i].material.opacity=clamp(gv*.55*p*gf,0,.85);
  }
}
function updWisps(t,cp,fwd,up,pw,gf){
  const wv=clamp(pw[0]*.4+pw[1]*.6+pw[2]+pw[3]+pw[4],0,1);
  const[s1,c1,s2,c2]=[sL(1,t),cL(1,t),sL(2,t),cL(2,t)];
  const r=new THREE.Vector3().crossVectors(fwd,up).normalize();
  const tu=new THREE.Vector3().crossVectors(r,fwd).normalize();
  const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r,tu,fwd.clone().negate()));
  const np=1.04+sL(1,t)*.18;

  // Wisps are atmospheric nebula — warm amber only, no bidder colour tint.
  wisps.forEach((w,wi)=>{
    const d=w.userData;
    w.position.x=d.ax*sL(d.fx,t,d.px)+cp.x*.10;
    w.position.y=d.ay*sL(d.fy,t,d.py)+cp.y*.10;
    w.position.z=tz(d.bz,cp.z,SLAB_P);
    w.quaternion.copy(q);
    const u=d.mat.uniforms;
    u.s1.value=s1; u.c1.value=c1; u.s2.value=s2; u.c2.value=c2;
    u.bri.value=d.baseBri*np;
    u.opa.value = wv > 0.15 ? wv*np*gf*.90 : 0;
    // Fixed warm gold — hue 0.07-0.10 only
    u.col.value.setHSL(.07+h(wi*11)*.03, .88, .58);
  });
}

// ═══════════════════════════════════════════════════════════════════
// TICK — main render loop: runs at FPS, drives all systems each frame
// ═══════════════════════════════════════════════════════════════════
function tick(frame){
  const t=frame/TOTAL_FRAMES;
  const gf=gFade(t);
  const droste=drosteEnv(t);
  const pw=phaseW(t);  // NOW includes externalPhaseBoost
  currentPhaseWeights = pw;

  // Decay phase boost gradually
  decayPhaseBoost();

  // Particle colours come from baked aC0/aC1 attributes.
  // applyBidPulses() handles uBidChroma/uBidChromaStr.

  cam.fov=56*(1+droste.fovB)*(1+sL(1,t)*.012);
  cam.updateProjectionMatrix();
  applyCamera(t);

  const cp=getPos(t),f=getFwd(t),u=getUp(t),cz=cp.z;
  const galPhase=clamp(pw[2]+pw[3]+pw[4],0,1);

  // Update cosmicState for bridge handler access
  cosmicState = { pos: cp, fwd: f, up: u, t, pw, gf };

  updateAgentShapes();
  applyBidPulses(t);                        // drive particle pulse from active bids
  tickPeakWatchers(pw, bidderChromaStack);  // agent peak detection — fires capture at visual maximum
  tileStar(cz,t,gf,frame);
  updateParticles(t,cz,pw);
  pMat.uniforms.uPB.value=clamp(galPhase,0,1);
  // uGF: particle brightness — base 1.0 ensures full brightness in all phases.
  pMat.uniforms.uGF.value=gf*(1.0+galPhase*.15);
  pMat.uniforms.uT.value=t;
  updateWebLines(t,cz,pw[3]+pw[4],gf,frame);
  updateCoreGlows(t,cz,pw,gf);
  updWisps(t,cp,f,u,pw,gf);

  renderer.render(scene,cam);
  compositeFrame(t,droste);
}

// ═══════════════════════════════════════════════════════════════════
// PLAYBACK — requestAnimationFrame loop, frame counter, fixed timestep
// ═══════════════════════════════════════════════════════════════════
// ── SMOOTH DETERMINISTIC LOOP ────────────────────────────────────────
// Uses elapsed time modulo the full loop duration so floating-point
// precision never degrades over long sessions.
//
// Loop wrap handling:
//   - externalPhaseBoost is gently zeroed in the final 5% of each cycle
//     so the wrap back to chaos phase is seamless (no phase jump).
//   - bidderChromaStack entries expire naturally (8s TTL), so they are
//     always gone by wrap time (cycle is 30s).
//   - _lastFrame guard prevents double-ticks on 60fps displays.

const LOOP_MS = (TOTAL_FRAMES / FPS) * 1000; // full loop duration in ms
let _startTime = null;
let _lastFrame = -1;
let _lastCycle = 0; // tracks cycle number for wrap detection

tick(0);

function animate(now) {
  requestAnimationFrame(animate);
  if (_startTime === null) _startTime = now;

  const totalElapsed = now - _startTime;
  const FRAME_MS = 1000 / FPS;

  // Position within current cycle — resets to 0 each loop.
  // Using modulo on ms-time avoids float precision drift.
  const cycleElapsed = totalElapsed % LOOP_MS;
  const cur = Math.floor(cycleElapsed / FRAME_MS) % TOTAL_FRAMES;
  const thisCycle = Math.floor(totalElapsed / LOOP_MS);

  // On cycle wrap: smoothly zero out phase boost so chaos restart is clean.
  if (thisCycle > _lastCycle) {
    _lastCycle = thisCycle;
    externalPhaseBoost = 0; // reset for clean cycle start
  }

  // In final 5% of cycle (frames 684–719): decay phase boost toward 0
  // so the wrap back to chaos is gradual, not a sudden phase jump.
  if (cur >= Math.floor(TOTAL_FRAMES * 0.95)) {
    externalPhaseBoost *= 0.85; // exponential decay over ~9 frames
  }

  if (cur !== _lastFrame) {
    _lastFrame = cur;
    tick(cur);
  }
}
requestAnimationFrame(animate);

// ── Keyboard shortcuts ────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  // Compute current frame from elapsed time (matches deterministic loop)
  const _now = performance.now();
  const cur = _startTime !== null
    ? Math.floor((_now - _startTime) / (1000/FPS)) % TOTAL_FRAMES
    : 0;
  const cp = getPos(cur / TOTAL_FRAMES);

  if (e.key === "0") {
    // Fetch mint log from bridge server (authoritative), fall back to local
    if (bridgeConnected) {
      fetch(BRIDGE_HTTP + '/mint-log')
        .then(r => r.json())
        .then(log => {
          const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'mint-log.json';
          a.click();
        })
        .catch(() => console.warn("Could not fetch mint log from bridge"));
    } else {
      console.warn("Bridge offline — mint log unavailable without server");
    }
  }

  // B key: POST to bridge /mock-bid so server-side mint path also runs.
  // Falls back to local-only visual if bridge is offline.
  if (e.key === "b") {
    const amount  = (Math.random() * 2).toFixed(3);
    const address = '0x' + Array.from({length: 40}, () =>
      Math.floor(Math.random() * 16).toString(16)).join('');

    function fireMockBidLocally(amt, addr) {
      const localBid = {
        count: ++_localBidCount,
        address: addr, amount: amt,
        txHash: '0x' + Math.random().toString(16).slice(2),
        timestamp: Date.now()
      };
      const h = Math.random();
      const amtF = parseFloat(amt);
      window.onBidReceived(localBid, {
        geometryType: amtF > 1 ? 'torus' : amtF > 0.3 ? 'tetra' : 'sphere',
        hue: h, sat: 0.7 + Math.random() * 0.3, lit: 0.5 + Math.random() * 0.25,
        phaseBoost: 0.08
      }, cp);
    }

    if (bridgeConnected) {
      fetch(BRIDGE_HTTP + '/mock-bid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, address })
      })
      .then(r => r.json())
      .then(d => console.log('🧪 Bridge mock bid registered:', d))
      .catch(() => fireMockBidLocally(amount, address));
    } else {
      fireMockBidLocally(amount, address);
    }
  }

  if (e.key === "1") injectGeometry("sphere", cp);
  if (e.key === "2") injectGeometry("torus", cp);
  if (e.key === "3") injectGeometry("tetra", cp);
  if (e.key === "9") {
    // captureFrame() returns Promise — sendCapture/downloadFrameManual handle async
    const bp = captureFrame();
    if (bridgeConnected) {
      sendCapture(bp, { count: cur, address: 'manual', amount: '0', txHash: 'manual' });
    } else {
      downloadFrameManual(bp, cur, currentPhaseWeights);
    }
  }
});

// ── Init bridge connection ─────────────────────────────────────────────
connectBridge();

}); // end window.load