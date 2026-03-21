#!/bin/bash
# deploy-contracts.sh
# Deploys both NFT contracts via Rare Protocol CLI
# Run once before the auction to set up the collections.
#
# Prerequisites:
#   npm install -g @rareprotocol/rare-cli
#   npx @rareprotocol/rare-cli configure --chain sepolia --private-key 0xYOUR_KEY --rpc-url https://YOUR_RPC
#   npx @rareprotocol/rare-cli configure --default-chain sepolia

set -e

echo ""
echo "🚀 Deploying Cosmic Emergence contracts..."
echo ""

# ── 1. Deploy main animation contract ──────────────────────────────
echo "Deploying: Cosmic Emergence (main animation)..."
MAIN_DEPLOY=$(npx @rareprotocol/rare-cli contract deploy \
  --name "Cosmic Emergence" \
  --symbol "COSMIC" \
  --max-supply 1 \
  --royalty-bps 1000 \
  --chain sepolia)

echo "$MAIN_DEPLOY"
MAIN_CONTRACT=$(echo "$MAIN_DEPLOY" | grep -oE '0x[a-fA-F0-9]{40}' | head -1)
echo "✅ Main contract: $MAIN_CONTRACT"
echo ""

# ── 2. Deploy Bidder's Edition contract ─────────────────────────────
echo "Deploying: Cosmic Emergence — Bidder's Edition..."
BIDDERS_DEPLOY=$(npx @rareprotocol/rare-cli contract deploy \
  --name "Cosmic Emergence — Bidder's Edition" \
  --symbol "COSMIC-BID" \
  --max-supply 100 \
  --royalty-bps 1000 \
  --chain sepolia)

echo "$BIDDERS_DEPLOY"
BIDDERS_CONTRACT=$(echo "$BIDDERS_DEPLOY" | grep -oE '0x[a-fA-F0-9]{40}' | head -1)
echo "✅ Bidder's Edition contract: $BIDDERS_CONTRACT"
echo ""

# ── 3. Save addresses to .env ────────────────────────────────────────
cat > .env << EOF
MAIN_CONTRACT=$MAIN_CONTRACT
BIDDERS_CONTRACT=$BIDDERS_CONTRACT
AUCTION_ADDRESS=
MOCK=0
EOF

echo "Addresses saved to .env"
echo ""

# ── 4. Mint the main animation (upload HTML/JS first) ──────────────
echo "─────────────────────────────────────────────────────"
echo "Next steps:"
echo ""
echo "1. Upload your animation files to IPFS:"
echo "   rare upload ./animation/  (or use Pinata/NFT.storage)"
echo ""
echo "2. Mint the main animation:"
echo "   rare mint --contract $MAIN_CONTRACT \\"
echo "     --token-uri ipfs://YOUR_ANIMATION_CID \\"
echo "     --to YOUR_WALLET_ADDRESS"
echo ""
echo "3. Create the auction:"
echo "   rare auction create \\"
echo "     --contract $MAIN_CONTRACT \\"
echo "     --token-id 1 \\"
echo "     --reserve-price 0.1 \\"
echo "     --duration 86400"
echo ""
echo "4. Set AUCTION_ADDRESS in .env, then start the bridge:"
echo "   cd bridge && MOCK=0 node server.js"
echo ""
