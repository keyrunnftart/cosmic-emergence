# Cosmic Emergence — Deployment Commands
# Wallet: 0xD0490ADeAa23cd45846372Aa09317a57A8880200
# Network: Sepolia testnet
# Run all commands from: C:\Users\keyru\Desktop\cosmic-emergence
# ─────────────────────────────────────────────────────────────

## STEP 1 — Configure rare-cli (run from root cosmic-emergence folder)
## Replace 0xYOUR_PRIVATE_KEY with your key from MetaMask Account 2.

```
npx @rareprotocol/rare-cli configure --chain sepolia --private-key 0xYOUR_PRIVATE_KEY --rpc-url https://sepolia.infura.io/v3/[REDACTED-ROTATED]
```
```
npx @rareprotocol/rare-cli configure --default-chain sepolia
```

## STEP 2 — Deploy both NFT contracts
## Windows PowerShell cannot run .sh files directly.
## Use one of these options:

### Option A: WSL (if installed)
```
bash scripts/deploy-contracts.sh
```

### Option B: Run each command manually in PowerShell
```
npx @rareprotocol/rare-cli contract deploy --name "Cosmic Emergence" --symbol "COSMIC" --max-supply 1 --royalty-bps 1000 --chain sepolia
```
(Save the contract address it prints — e.g. 0xABC...)

```
npx @rareprotocol/rare-cli contract deploy --name "Cosmic Emergence - Bidders Edition" --symbol "COSMIC-BID" --max-supply 100 --royalty-bps 1000 --chain sepolia
```
(Save this address too)

## STEP 3 — Upload animation to IPFS
```
npx @rareprotocol/rare-cli upload ./animation/
```
Save the CID it returns (looks like: Qm...)

## STEP 4 — Mint the main animation token
```
npx @rareprotocol/rare-cli mint --contract PASTE_MAIN_CONTRACT --token-uri ipfs://PASTE_CID --to 0xD0490ADeAa23cd45846372Aa09317a57A8880200
```

## STEP 5 — Create the auction
```
npx @rareprotocol/rare-cli auction create --contract PASTE_MAIN_CONTRACT --token-id 1 --reserve-price 0.1 --duration 86400
```
Save the auction address it returns.

## STEP 6 — Start bridge in live mode (bridge folder)
```
cd bridge
$env:MOCK="0"; $env:AUCTION_ADDRESS="PASTE_AUCTION_ADDRESS"; node server.js
```

## ─────────────────────────────────────────────────────────────
## HOW TO GET PRIVATE KEY FROM METAMASK
## 1. Open MetaMask → click Account 2
## 2. Click three dots (⋮) → Account details
## 3. Click "Show private key"
## 4. Enter MetaMask password → copy the 0x... string
## ⚠️  Only paste into terminal. Never share with anyone.
## ─────────────────────────────────────────────────────────────
