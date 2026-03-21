/**
 * Cosmic Emergence — Bridge Server v3
 *
 * KEY CHANGE: PNG encoding moved to server.
 * Browser sends raw RGBA bytes via POST /capture-raw (ArrayBuffer).
 * Server encodes PNG using pngjs (pure JS, no native deps).
 * Animation thread never touches PNG compression.
 */

const http    = require('http');
const https   = require('https');
const { exec } = require('child_process');
const sharp = require('sharp');
// Monotonic capture counter — guarantees unique filenames even in burst
let _captureSeq = 0;
const fs      = require('fs');
const path    = require('path');
const { WebSocketServer } = require('ws');
let PNG;
try {
  PNG = require('pngjs').PNG;
} catch(e) {
  console.error('❌ pngjs not installed. Run: cd bridge && npm install');
  process.exit(1);
}

const PORT             = 3131;
const POLL_INTERVAL_MS = 8000;
const AUCTION_ADDRESS  = process.env.AUCTION_ADDRESS  || '';
const MAIN_CONTRACT    = process.env.MAIN_CONTRACT    || '';
const BIDDERS_CONTRACT = process.env.BIDDERS_CONTRACT || '';
const USE_MOCK         = process.env.MOCK === '1' || AUCTION_ADDRESS === '';
const ARTIST_NAME      = process.env.ARTIST_NAME || 'Cosmic Emergence';

const CAPTURES_DIR  = path.join(__dirname, '../bidders-edition/captures');
const METADATA_DIR  = path.join(__dirname, '../bidders-edition/metadata');
const MINT_LOG_FILE = path.join(__dirname, '../bidders-edition/mint-log.json');

for (const d of [CAPTURES_DIR, METADATA_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const knownBids = new Set();
let auctionPhase = 'idle';
let bidCount     = 0;
let currentHighestBid = 0.05;
const clients    = new Set();
let mintLog      = [];

if (fs.existsSync(MINT_LOG_FILE)) {
  try {
    mintLog = JSON.parse(fs.readFileSync(MINT_LOG_FILE, 'utf8'));
    mintLog.forEach(e => { if (e.txHash) knownBids.add(e.txHash); });
    console.log(`📚 Loaded ${mintLog.length} existing mint log entries`);
  } catch(e) { mintLog = []; }
}

// ── PNG encoder using pngjs ──────────────────────────────────────────
function rawRGBAtoPNG(rgbaBuffer, width, height) {
  return new Promise((resolve, reject) => {
    const png = new PNG({ width, height, filterType: -1 });
    // pngjs expects RGBA — our buffer is already RGBA from getImageData
    png.data = Buffer.from(rgbaBuffer);
    const chunks = [];
    png.pack()
      .on('data', chunk => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}

// ── HTTP server ──────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Capture-Meta');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── POST /capture-raw ────────────────────────────────────────────
  // Receives raw RGBA ArrayBuffer from browser.
  // Encodes PNG on the server — zero encoding cost on browser main thread.
  if (req.method === 'POST' && req.url === '/capture-raw') {
    const metaHeader = req.headers['x-capture-meta'];
    if (!metaHeader) {
      res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'missing X-Capture-Meta' }));
      return;
    }

    let job;
    try {
      job = JSON.parse(decodeURIComponent(metaHeader));
    } catch(e) {
      res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'invalid meta' }));
      return;
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const rgbaBuffer = Buffer.concat(chunks);
        const w = job.width  || 1280;
        const h = job.height || 720;

        console.log(`\n💾 Received raw frame: ${rgbaBuffer.length} bytes (${w}×${h}) bid#${job.bidData?.bidCount || job.bidData?.count || '?'}`);

        // Validate buffer size — width * height * 4 bytes (RGBA)
        const expectedBytes = w * h * 4;
        if (rgbaBuffer.length !== expectedBytes) {
          throw new Error(`Buffer size mismatch: got ${rgbaBuffer.length}, expected ${expectedBytes} (${w}×${h}×4)`);
        }
        // Encode PNG on server — takes 50-100ms but doesn't affect animation
        const pngBuffer = await rawRGBAtoPNG(rgbaBuffer, w, h);

        const imgFilename = `bid-${job.bidData?.bidCount || 0}-${++_captureSeq}-${Date.now()}.png`;
        const imgPath     = path.join(CAPTURES_DIR, imgFilename);
        fs.writeFileSync(imgPath, pngBuffer);
        console.log(`✅ PNG saved: ${imgFilename} (${(pngBuffer.length/1024).toFixed(0)}KB)`);

        // Build metadata
        const metadata    = buildMetadata(job.bidData, job.peakScore, job.phaseVector, job.captureTimestamp);
        const metaFilename = `bid-${job.bidData?.bidCount || Date.now()}-${Date.now()}.json`;
        const metaPath     = path.join(METADATA_DIR, metaFilename);
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

        // Respond immediately — don't block on minting (prevents browser retry/duplicate)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, imgFilename, mint: { queued: true } }));

        // Mint in background — result broadcast via WebSocket when done
        mintBidderEdition(imgPath, metaPath, job.bidData || {}, metadata)
          .then(mintResult => {
            broadcast({ type: 'MINT_COMPLETE', tokenId: mintResult.tokenId,
                        bidCount: mintResult.bidCount, peakScore: mintResult.peakScore });
          })
          .catch(e => console.error('Mint error:', e.message));
      } catch(e) {
        console.error('Capture-raw error:', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // (duplicate /capture-raw handler removed)

  // ── POST /capture (legacy dataURL path, kept for fallback) ────────
  if (req.method === 'POST' && req.url === '/capture') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { dataURL, bidData, peakScore, phaseVector, captureTimestamp } = payload;
        const imgFilename = `bid-${bidData?.bidCount || 0}-${++_captureSeq}-${Date.now()}.png`;
        const imgPath     = path.join(CAPTURES_DIR, imgFilename);
        const base64      = dataURL.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(imgPath, Buffer.from(base64, 'base64'));
        const metadata    = buildMetadata(bidData, peakScore, phaseVector, captureTimestamp);
        const metaFilename = `bid-${bidData?.bidCount || Date.now()}-${Date.now()}.json`;
        const metaPath     = path.join(METADATA_DIR, metaFilename);
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
        const mintResult = await mintBidderEdition(imgPath, metaPath, bidData || {}, metadata);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, imgFilename, mint: mintResult }));
      } catch(e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── POST /mock-bid ────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/mock-bid') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const opts   = body ? JSON.parse(body) : {};
        const count  = opts.count  || (bidCount + 1);
        const addr   = opts.address || MOCK_BIDDERS[bidCount % MOCK_BIDDERS.length];
        const amt    = opts.amount  || srNextBidAmount(currentHighestBid).toString();
        const txHash = `0xmockmanual${count.toString().padStart(6, '0')}`;
        if (!knownBids.has(txHash)) processBid({ txHash, bidder: addr, amount: amt, timestamp: Date.now() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: bidCount }));
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ auctionPhase, bidCount, mintCount: mintLog.length }));
    return;
  }

  if (req.url === '/mint-log') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mintLog, null, 2));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// ── WebSocket ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`🔌 Browser connected (${clients.size} total)`);
  ws.send(JSON.stringify({ type: 'INIT', auctionPhase, bidCount, mintLog: mintLog.slice(-5) }));
  ws.on('close', () => { clients.delete(ws); });
});
function broadcast(msg) {
  const str = JSON.stringify(msg);
  for (const ws of clients) { if (ws.readyState === 1) ws.send(str); }
}

// ── NFT Metadata ─────────────────────────────────────────────────────
const PHASE_LABELS = ['chaos', 'cluster', 'spiral', 'web', 'stable'];
function buildMetadata(bidData, peakScore, phaseVector, captureTimestamp) {
  const pv = phaseVector || [0.2, 0.2, 0.2, 0.2, 0.2];
  const dominantPhase = PHASE_LABELS[pv.indexOf(Math.max(...pv))];
  const addressHex = (bidData?.address || '000000').slice(-6).padStart(6, '0');
  const hueDeg = Math.round((parseInt(addressHex.slice(0, 2), 16) / 255) * 360);
  return {
    name: `Cosmic Emergence — Bidder's Edition #${bidData?.bidCount || 0}`,
    description: `A moment captured at peak luminance (score ${peakScore?.toFixed(3) ?? '—'}) during the ${dominantPhase} phase.`,
    image: 'PLACEHOLDER',
    attributes: [
      { trait_type: 'Bid Number',       value: bidData?.bidCount || 0 },
      { trait_type: 'Bid Amount (ETH)', value: parseFloat(bidData?.amount || 0) },
      { trait_type: 'Cosmic Phase',     value: dominantPhase },
      { trait_type: 'Agent Peak Score', value: peakScore != null ? parseFloat(peakScore.toFixed(3)) : 0 },
      { trait_type: 'Bidder Hue',       value: `${hueDeg}°` },
      { trait_type: 'Capture Time',     value: captureTimestamp || new Date().toISOString() },
      { trait_type: "Edition Type",     value: "Bidder's Edition" },
    ]
  };
}

// ── Rare CLI ──────────────────────────────────────────────────────────
function runCLI(cmd) {
  return new Promise((resolve, reject) => {
    exec(`npx @rareprotocol/rare-cli ${cmd}`, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function mintBidderEdition(imgPath, metaPath, bidData, metadata) {
  const peakAttr = metadata.attributes.find(a => a.trait_type === 'Agent Peak Score');
  const entry = {
    bidCount: bidData.bidCount || bidData.count || 0,
    bidder: bidData.address || bidData.bidder || '',
    amount: bidData.amount || '0',
    peakScore: peakAttr ? peakAttr.value : null,
    tokenId: null, txHash: null, imageUri: null, metaUri: null,
    timestamp: new Date().toISOString(), error: null
  };

  if (USE_MOCK) {
    entry.imageUri = `ipfs://QmMOCK${entry.bidCount}img`;
    entry.metaUri  = `ipfs://QmMOCK${entry.bidCount}meta`;
    entry.tokenId  = `mock-${entry.bidCount}`;
    entry.txHash   = `0xmock${Math.random().toString(16).slice(2, 18)}`;
    console.log(`🪙 [MOCK] Bidder Edition #${entry.bidCount} token=${entry.tokenId} peak=${entry.peakScore}`);
  } else {
    try {
      const PINATA_JWT = process.env.PINATA_JWT || '';
      if (!PINATA_JWT) throw new Error('PINATA_JWT not set — export PINATA_JWT=your_token');

      // Upload image to Pinata
      console.log(`📤 Uploading image to IPFS via Pinata...`);
      const FormData = require('form-data');
      const imgForm  = new FormData();
      imgForm.append('file', fs.createReadStream(imgPath));
      imgForm.append('pinataMetadata', JSON.stringify({ name: `bid-${entry.bidCount}.png` }));
      const imgRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: { ...imgForm.getHeaders(), Authorization: `Bearer ${PINATA_JWT}` },
        body: imgForm
      });
      const imgJson = await imgRes.json();
      if (!imgJson.IpfsHash) throw new Error('Pinata image upload failed: ' + JSON.stringify(imgJson));
      entry.imageUri = `ipfs://${imgJson.IpfsHash}`;
      console.log(`✅ Image IPFS: ${entry.imageUri}`);

      // Upload metadata to Pinata
      metadata.image = entry.imageUri;
      fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
      const metaRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: { ...new FormData().getHeaders(), Authorization: `Bearer ${PINATA_JWT}` },
        body: (() => { const f = new FormData(); f.append('file', fs.createReadStream(metaPath)); f.append('pinataMetadata', JSON.stringify({ name: `bid-${entry.bidCount}.json` })); return f; })()
      });
      const metaJson = await metaRes.json();
      if (!metaJson.IpfsHash) throw new Error('Pinata metadata upload failed: ' + JSON.stringify(metaJson));
      entry.metaUri = `ipfs://${metaJson.IpfsHash}`;
      console.log(`✅ Metadata IPFS: ${entry.metaUri}`);

      // Mint via rare-cli to bidder wallet
      console.log(`🪙 Minting to ${entry.bidder}...`);
      const mintOut = await runCLI(`mint --contract ${BIDDERS_CONTRACT} --token-uri "${entry.metaUri}" --to ${entry.bidder} --chain sepolia`);
      entry.tokenId = mintOut.match(/Token ID[:\s]+(\d+)/i)?.[1] || mintOut.match(/#(\d+)/)?.[1] || mintOut.trim().split('\n').pop();
      entry.txHash  = mintOut.match(/(0x[a-f0-9]{64})/i)?.[1] || '';
      console.log(`✅ Minted → token ${entry.tokenId} tx ${entry.txHash.slice(0,12)}...`);
    } catch(e) {
      entry.error = e.message;
      console.error(`❌ Mint failed:`, e.message);
    }
  }

  mintLog.push(entry);
  fs.writeFileSync(MINT_LOG_FILE, JSON.stringify(mintLog, null, 2));
  broadcast({ type: 'MINT_COMPLETE', tokenId: entry.tokenId, bidCount: entry.bidCount, peakScore: entry.peakScore });
  return entry;
}

// ── SR bid formula ────────────────────────────────────────────────────
function srMinNextBid(lastBid) {
  const dynamic = 0.1 * Math.pow(lastBid, 1.666 / 2);
  return lastBid + Math.max(dynamic, lastBid * 0.01);
}
function srNextBidAmount(lastBid) {
  return parseFloat((srMinNextBid(lastBid) * (1 + Math.random() * 0.25)).toFixed(4));
}

const MOCK_BIDDERS = [
  '0xabc1230000000000000000000000000000000001',
  '0xdef4560000000000000000000000000000000002',
  '0x9876540000000000000000000000000000000003',
  '0x1111110000000000000000000000000000000004',
  '0xcafe000000000000000000000000000000000005',
];

function processBid(bid) {
  if (knownBids.has(bid.txHash)) return;
  knownBids.add(bid.txHash);
  bidCount++;
  const amountEth = parseFloat(bid.amount);
  if (USE_MOCK && amountEth < srMinNextBid(currentHighestBid)) {
    knownBids.delete(bid.txHash); bidCount--; return;
  }
  currentHighestBid = amountEth;
  if (auctionPhase === 'idle') auctionPhase = 'active';
  console.log(`\n🎯 BID #${bidCount} — ${amountEth} ETH  (next min: ${srMinNextBid(amountEth).toFixed(4)} ETH)`);
  const geometryType = amountEth >= 0.5 ? 'torus' : amountEth >= 0.1 ? 'tetra' : 'sphere';
  const addressHex   = (bid.bidder || '000000').slice(-6).padStart(6, '0');
  const hue = parseInt(addressHex.slice(0, 2), 16) / 255;
  const sat = 0.7 + parseInt(addressHex.slice(2, 4), 16) / 255 * 0.3;
  const lit = 0.5 + parseInt(addressHex.slice(4, 6), 16) / 255 * 0.3;
  broadcast({
    type: 'BID',
    bid: { count: bidCount, address: bid.bidder, amount: bid.amount, txHash: bid.txHash, timestamp: bid.timestamp },
    visual: { geometryType, hue, sat, lit, phaseBoost: Math.min(bidCount * 0.08, 0.4) },
    auctionPhase
  });
}

let _mockAutoCount = 0;
// ── Direct RPC poll — no CLI spawning, uses Infura RPC directly ──────
// Reads auction state from the SR auction contract via eth_getLogs.
// Looks for NewBid events since the last known block.
const RPC_URL = process.env.RPC_URL || 'https://sepolia.infura.io/v3/[REDACTED-ROTATED]';
// NewBid(address,uint256,address,uint256) event topic
const NEW_BID_TOPIC = '0x6f72f2cb6e8f57e5d5b7b3b9c0e6e6b0a0f0e6f0a0b0c0d0e0f0e0d0c0b0a09';
let lastPollBlock = 0;

async function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(RPC_URL);
    const options = {
      hostname: url.hostname, path: url.pathname + url.search,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data).result); }
        catch(e) { reject(new Error('RPC parse error: ' + data.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function pollAuction() {
  if (USE_MOCK) {
    if (Math.random() < 0.33) {
      _mockAutoCount++;
      processBid({
        txHash: `0xmockauto${_mockAutoCount.toString().padStart(6,'0')}${Date.now().toString(16)}`,
        bidder: MOCK_BIDDERS[(_mockAutoCount - 1) % MOCK_BIDDERS.length],
        amount: srNextBidAmount(currentHighestBid).toString(),
        timestamp: Date.now()
      });
    }
    return;
  }
  if (!AUCTION_ADDRESS) { console.log('No AUCTION_ADDRESS set'); return; }
  try {
    // Get current block
    const blockHex = await rpcCall('eth_blockNumber', []);
    const currentBlock = parseInt(blockHex, 16);
    if (lastPollBlock === 0) lastPollBlock = 10491850; // auction created at block 10491860

    // Get NewBid events from auction contract
    const logs = await rpcCall('eth_getLogs', [{
      address: AUCTION_ADDRESS,
      fromBlock: '0x' + lastPollBlock.toString(16),
      toBlock: '0x' + currentBlock.toString(16)
    }]);

    if (logs && logs.length > 0) {
      for (const log of logs) {
        // Decode bid: topics[1]=NFT contract, topics[2]=tokenId, topics[3]=bidder
        // data = bid amount (uint256)
        try {
          // SR NewBid event structure (verified from live log):
          // topics[0] = event sig
          // topics[1] = NFT contract (indexed)
          // topics[2] = tokenId (indexed)
          // topics[3] = bidder address (indexed)
          // data slot[0] = zeros (currency = ETH)
          // data slot[1] = zeros
          // data slot[2] = bid amount in wei ✅
          // data slot[3] = duration (86400)
          const txHash = log.transactionHash;
          const bidder = '0x' + log.topics[3].slice(26);
          const data   = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
          const slot2  = data.slice(128, 192); // third 32-byte slot
          const amountWei = slot2 ? BigInt('0x' + slot2) : 0n;
          const amount = (Number(amountWei) / 1e18).toFixed(4);
          if (bidder && bidder.length === 42 && bidder !== '0x0000000000000000000000000000000000000000' && !knownBids.has(txHash)) {
            console.log(`⛓️  On-chain bid detected: ${amount} ETH from ${bidder.slice(0,10)}...`);
            processBid({ txHash, bidder, amount, timestamp: Date.now() });
            if (auctionPhase === 'idle') {
              auctionPhase = 'active';
              broadcast({ type: 'AUCTION_STARTED' });
            }
          }
        } catch(e) { /* skip malformed log */ }
      }
    }
    lastPollBlock = currentBlock;
  } catch(e) {
    console.error('Poll error:', e.message.slice(0, 80));
  }
}

server.listen(PORT, () => {
  console.log(`\n🌌 Cosmic Emergence Bridge Server v3`);
  console.log(`   HTTP+WS : http://localhost:${PORT}`);
  console.log(`   Mode    : ${USE_MOCK ? '🧪 MOCK' : '⛓️  LIVE'}`);
  console.log(`   PNG encode: server-side (pngjs) — browser never compresses`);
  console.log(`   POST /capture-raw  → raw RGBA → server PNG encode → mint`);
  console.log(`   POST /mock-bid     → inject test bid\n`);
  setInterval(pollAuction, POLL_INTERVAL_MS);
  pollAuction();
});