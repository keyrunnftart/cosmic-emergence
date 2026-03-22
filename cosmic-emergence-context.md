# Cosmic Emergence — Full Project Context for New Claude Instance

## What Was Built
A live 4K WebGL generative art animation where every SuperRare auction bid reshapes the cosmos. Built in one session (~16 hours) for The Synthesis Hackathon 2026. First ever hackathon participation.

## Project Concept
- Bidder wallet address → seeds unique colour flooding particle system
- Bid amount → determines pulse geometry (sphere=0.55 ETH, tetra=0.75, torus=1.0)
- Bid count → accelerates cosmic phase evolution (chaos→cluster→spiral→web→stable)
- Peak detection agent → scores frames → mints Bidder Edition NFT to bidder wallet at visual maximum

## File Location
All code at: `C:\Users\keyru\Desktop\cosmic-emergence\`
```
animation/
  index.html        — canvas + HUD overlay
  sketch.js         — Three.js animation + blockchain integration (~1439 lines)
bridge/
  server.js         — Node.js WebSocket bridge + PNG capture + Rare CLI minting
  package.json
bidders-edition/
  captures/         — PNG per bid
agent.json          — agent capability manifest
agent_log.json      — execution log
README.md
```

GitHub: https://github.com/keyrunnftart/cosmic-emergence

## Credentials & Keys

### Hackathon
- Synthesis API key: `sk-synth-76dd9e96c6b60f8c3f5c35f8f83c44d94db809aa3c991c0d`
- Participant UUID: `88ad5e14c73546a08cfd8db43d94f02c`
- Team UUID: `c4fcdedf5c044b17804fb126f7a89275`
- Project UUID: `ab0d9456716c4ac3bd52d338a318a341`
- Project slug: `cosmic-emergence-66f8`
- Hackathon UUID: `d9476980c3854afcaa36d853fa966256`

### Blockchain
- Hackathon wallet: `0xD0490ADeAa23cd45846372Aa09317a57A8880200`
- Main contract (Sepolia): `0xCCa8680ae03cDcd5841ae1C252A0eaE067c52398`
- Bidders contract (Sepolia): `0x651e3EB4325f74A49Ba5Fc93E0b96e95F103D600`
- Auction contract (Sepolia): `0xC8Edc7049b233641ad3723D6C60019D1c8771612`
- SR Factory: `0x3c7526a0975156299ceef369b8ff3c01cc670523`
- Infura RPC: `https://sepolia.infura.io/v3/[REDACTED-ROTATED]`
- IPFS CID (animation): `bafybeifi2c4v5ns6dkinq3sy3jy5xh2lgsfbcrwoojsz3flbg33hfmaray`

### On-chain Transactions
- Token #1 mint tx: `0x652b337811a35c2ebe66bf045ae67ea67226d19c70f727befe737ce5deabcdf1`
- Auction creation tx: `0xfb0059e1f04490f47855ff122aaa3725084495aa0cca1eb4dfa554d9d6c19010`
- First real bid tx: `0x6d4be59316ea524a519c611d831ea48598683d57d241c2f81c365cb8bf1fe681`
- ERC-8004 registration tx: `0x8cfda7cf5391a7085d2920c0b0fdb0d6c95d60bf3b588d5a854149aaed73d344`
- Self-custody tx: `0x20dfec0b8ededf32cec9a218c1e9b21ddeb8c70d61bc8f0a4c2d286a8339c0e1`

### Services
- Pinata JWT: `[REDACTED-ROTATED]` (truncated — check bridge/.env or server.js)
- Moltbook API key: `[REDACTED-ROTATED]`
- Moltbook agent: `cosmicemergence` at https://www.moltbook.com/u/cosmicemergence
- Twitter/X: @keyrunnftart

### Hackathon Tracks Entered
- SuperRare Partner Track: `228747d95f734d87bb8668a682a2ae4d`
- Synthesis Open Track: `fdb76d08812b43f6a5f454744b66f590`
- Let the Agent Cook: `10bd47fac07e4f85bda33ba482695b24`
- Agents With Receipts ERC-8004: `3bf41be958da497bbb69f1a150c76af9`

## Submission Status (as of March 22, 2026)
- Status: PUBLISHED ✅
- Video: https://youtu.be/3eZbkBg1FGc ✅
- Cover image: https://sapphire-famous-mole-216.mypinata.cloud/ipfs/bafybeiejelyunncusvicc5sjfg76gevwaucshlicnvbny2jasy6rhd6jum ✅
- Moltbook post URL: https://www.moltbook.com/u/cosmicemergence ✅
- agent.json + agent_log.json: in GitHub repo ✅
- ERC-8004 on Base mainnet ✅

## Running Locally (Windows PowerShell)

### Bridge (LIVE mode):
```powershell
cd bridge
$env:MOCK="0"
$env:MAIN_CONTRACT="0xCCa8680ae03cDcd5841ae1C252A0eaE067c52398"
$env:AUCTION_ADDRESS="0xC8Edc7049b233641ad3723D6C60019D1c8771612"
$env:BIDDERS_CONTRACT="0x651e3EB4325f74A49Ba5Fc93E0b96e95F103D600"
$env:PINATA_JWT="eyJ..."
node server.js
```

### Bridge (MOCK mode for testing):
```powershell
$env:MOCK="1"; node server.js
```

### Animation:
```powershell
cd animation
npx serve .
# Open http://localhost:3000 in Chrome
```

### Keyboard shortcuts:
- B = simulate bid
- 9 = manual capture
- 0 = download log
- K = toggle key hints

## Architecture
```
SuperRare Auction (Sepolia) — polled every 8s via Infura eth_getLogs
  ↓ NewBid event decoded from log data
Node.js Bridge (ws://localhost:3131)
  ↓ WebSocket BID event → browser
Browser Animation (sketch.js)
  ↓ bid pulse + phase boost + bidder chroma
  ↓ PeakWatcher agent scores frames (400ms min, 3s max)
  ↓ captureFrame() → 120ms setTimeout → getImageData from cSnap
  ↓ fetch POST /capture-raw with retry
Bridge → pngjs PNG encode → Pinata IPFS → rare-cli mint → bidder wallet
  ↓ MINT_COMPLETE broadcast → HUD update
```

## Key Technical Details
- Render: 4K (3840x2160), Three.js r128, ACESFilmicToneMapping
- Particles: NP=26,000, warm amber/gold palette
- Capture canvas: cSnap (2560x1440)
- Bloom: 5 passes, spread=0.9, STR=0.22
- Loop: 30 seconds deterministic (720 frames at 24fps)
- Peak detection: geometryScore*0.50 + chromaIntensity*0.30 + phaseScore*0.20
- Auction polling: eth_getLogs from block 10491850, every 8s

## Competition Analysis (SuperRare Track — 12 submissions)
1. Anima — mainnet, self-sustaining economics, 107 commits — clear 1st
2. Rare SynETHsis (xibot — established cryptoartist) — Ethereum mainnet genesis — 2nd
3. Cosmic Emergence — Sepolia, real bid detected, live visual — estimated 3rd (~$300-500)
4. DeviantClaw — gallery infrastructure, 290 commits

## PowerShell API Pattern
```powershell
$body = '{"json":"here"}'
Invoke-WebRequest -Uri "https://synthesis.devfolio.co/ENDPOINT" -Method POST -ContentType "application/json" -Headers @{Authorization="Bearer sk-synth-76dd9e96c6b60f8c3f5c35f8f83c44d94db809aa3c991c0d"} -Body $body -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -UseBasicParsing | Select-Object -ExpandProperty Content
```

## Second Entry Opportunity
Status Gasless track ($2,000 split equally among all qualifiers):
- Deploy a contract on Status Network Sepolia (Chain ID: 1660990954, gas=0)
- Requires: contract deployment + 1 gasless tx + AI agent component + README/video
- Low competition threshold, designed to reward participation
- Can reuse existing agent identity, GitHub repo structure, and Moltbook account

## Artist's SuperRare Profile
- Existing listing: Three.js animation (dynamic color change hourly) at 0.23 ETH — not sold
- Suggested Cosmic Emergence pricing: 0.5 ETH for 1/1 main animation
- Bidder Edition captures: 0.05-0.08 ETH each
- Timing: wait for prize announcement before listing on mainnet
