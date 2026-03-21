# Cosmic Emergence

**Live generative art driven by SuperRare auction bids.**

A 4K WebGL animation where every bid reshapes the cosmos. The bidder's wallet address seeds a unique colour. The bid amount determines pulse strength. Accumulated bids push the universe through 5 evolutionary phases — chaos → cluster → spiral → web → stable.

An autonomous agent monitors the auction every 8 seconds, detects visual peaks using a scoring formula, and mints a unique **Bidder's Edition** NFT to each bidder's wallet at the moment of maximum visual impact.

---

## How it works

```
SuperRare Auction (Sepolia)
  ↓ polled every 8s via Infura RPC
Node.js Bridge (ws://localhost:3131)
  ↓ WebSocket BID event → browser
Three.js Animation (sketch.js)
  ↓ bid pulse + phase boost + bidder chroma
  ↓ PeakWatcher agent scores each frame
  ↓ fires capture at visual maximum
  ↓ raw RGBA → POST /capture-raw
Bridge → sharp PNG encode → Pinata IPFS → rare-cli mint → bidder wallet
```

## On-chain artifacts (Sepolia testnet)

| Contract | Address |
|----------|---------|
| Main animation (1/1) | `0xCCa8680ae03cDcd5841ae1C252A0eaE067c52398` |
| Bidder's Edition | `0x651e3EB4325f74A49Ba5Fc93E0b96e95F103D600` |
| SR Auction | `0xC8Edc7049b233641ad3723D6C60019D1c8771612` |
| SR Factory | `0x3c7526a0975156299ceef369b8ff3c01cc670523` |

**Etherscan:**
- [Main contract](https://sepolia.etherscan.io/address/0xCCa8680ae03cDcd5841ae1C252A0eaE067c52398)
- [Bidder's Edition contract](https://sepolia.etherscan.io/address/0x651e3EB4325f74A49Ba5Fc93E0b96e95F103D600)
- [Auction creation tx](https://sepolia.etherscan.io/tx/0xfb0059e1f04490f47855ff122aaa3725084495aa0cca1eb4dfa554d9d6c19010)
- [Token #1 mint tx](https://sepolia.etherscan.io/tx/0x652b337811a35c2ebe66bf045ae67ea67226d19c70f727befe737ce5deabcdf1)
- [First bid tx](https://sepolia.etherscan.io/tx/0x6d4be59316ea524a519c611d831ea48598683d57d241c2f81c365cb8bf1fe681)

---

## Structure

```
cosmic-emergence/
  animation/
    index.html        — canvas + HUD overlay
    sketch.js         — Three.js animation + blockchain integration
  bridge/
    server.js         — Node.js WebSocket bridge + PNG capture + minting
    package.json
  scripts/
    deploy-contracts.sh
  ARTIST_STATEMENT.md
  README.md
```

## Running locally

**Prerequisites:** Node.js 18+, npm

**1. Install bridge dependencies:**
```bash
cd bridge
npm install
```

**2. Start bridge (mock mode for testing):**
```bash
$env:MOCK="1"; node server.js
```

**3. Start animation:**
```bash
cd ../animation
npx serve .
```

Open `http://localhost:3000` in Chrome. Press `B` to simulate a bid.

**Live mode (Sepolia):**
```bash
$env:MOCK="0"
$env:MAIN_CONTRACT="0xCCa8680ae03cDcd5841ae1C252A0eaE067c52398"
$env:AUCTION_ADDRESS="0xC8Edc7049b233641ad3723D6C60019D1c8771612"
$env:BIDDERS_CONTRACT="0x651e3EB4325f74A49Ba5Fc93E0b96e95F103D600"
$env:PINATA_JWT="your_pinata_jwt"
node server.js
```

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `B` | Simulate bid |
| `9` | Manual capture |
| `0` | Download mint log |
| `K` | Toggle key hints |

## Tech stack

- **Three.js r128** — WebGL particle system, 26K particles, ACES filmic HDR
- **Node.js** — WebSocket bridge, PNG encoding (pngjs/sharp), IPFS upload
- **Rare Protocol CLI** — ERC-721 contract deployment and minting
- **Pinata** — IPFS storage for images and metadata
- **Infura** — Sepolia RPC for auction event polling

## Licence

CC BY-NC-ND 4.0 — view and share with attribution, no commercial use, no derivatives.

© 2026 keyrunnftart
