# How to Test Cosmic Emergence on Your Laptop
## Step by step — as simple as possible

---

## WHAT YOU'LL END UP WITH

Two things running at the same time on your laptop:
1. **The bridge** — a small helper program (like a server behind the scenes)
2. **The animation** — opens in your browser like any website

When you press **B** on your keyboard, it pretends a bid came in and you watch the whole thing work.

---

## PART 1 — One-time setup (do this once, ever)

### Step 1 — Check if Node.js is on your laptop

Open **Terminal** (Mac: press Cmd+Space, type "Terminal", press Enter)

Type this and press Enter:
```
node --version
```

You should see something like `v20.0.0` or `v22.0.0`.

**If you see a version number → great, skip to Step 2.**

**If you see an error** → go to https://nodejs.org, click the big green "LTS" button, download and install it. Then come back here.

---

### Step 2 — Download your project files

You have two files to download from this chat:
- `sketch.js`
- `server.js`
- `index.html`

Make a folder on your Desktop called **cosmic-emergence**.

Inside it, make two more folders:
```
cosmic-emergence/
  animation/       ← put index.html and sketch.js here
  bridge/          ← put server.js here
```

So it looks like this:
```
Desktop/
  cosmic-emergence/
    animation/
      index.html
      sketch.js
    bridge/
      server.js
```

---

### Step 3 — Install the one thing the bridge needs

In Terminal, go into the bridge folder. Type this exactly:

```
cd ~/Desktop/cosmic-emergence/bridge
```

Press Enter. Then type:

```
npm init -y && npm install ws
```

Press Enter. Wait for it to finish (about 10 seconds). You'll see some text scroll by — that's normal.

You're done with setup. You never need to do this again.

---

## PART 2 — Running it (do this every time you want to test)

You need **two Terminal windows open at the same time**.

### Window 1 — Start the bridge

```
cd ~/Desktop/cosmic-emergence/bridge
MOCK=1 node server.js
```

You should see:
```
🌌 Cosmic Emergence Bridge Server v2
   HTTP+WS : http://localhost:3131
   Mode    : 🧪 MOCK
```

**Leave this window open. Don't close it.**

---

### Window 2 — Open the animation in your browser

The simplest way — no VS Code needed:

```
cd ~/Desktop/cosmic-emergence/animation
npx serve .
```

You'll see something like:
```
Serving!  http://localhost:3000
```

Open your browser (Chrome works best) and go to:
```
http://localhost:3000
```

The animation should appear — dark space with glowing particles and an infinity symbol.

---

## PART 3 — Testing it

### The one key you need: press B

Click on the browser window first (so it knows you're pressing keys into it).

Then press the **B** key on your keyboard.

**What you should see happen:**

1. A shape appears in the animation (sphere, tetrahedron, or torus — depends on the random "bid amount")
2. The color of everything shifts slightly (the "bidder's color")
3. After about 1–3 seconds, the agent decides this is the peak moment
4. In Terminal Window 1 you'll see:
```
🎯 BID #1 — 0.42 ETH from 0xabc...
💾 Frame saved: bid-1-1234567.png
🪙 [MOCK] Bidder Edition #1  token=mock-1  peak=0.74
```
5. A file appears in: `cosmic-emergence/bidders-edition/captures/` — this is the "Bidder's Edition" image
6. A file appears in: `cosmic-emergence/bidders-edition/metadata/` — this is the NFT metadata

**Press B again** a few more times. Each press = one bid = one saved image.

---

### What the bottom of the screen shows

There's a small status bar at the bottom of the animation:
```
BRIDGE ⛓️ LIVE  |  AUCTION 🔴 0.42 ETH  |  BIDS 1 bids  |  MINTED token mock-1
```

- **BRIDGE ⛓️ LIVE** = bridge is connected ✅
- **BRIDGE ○ offline** = bridge isn't running (go start Window 1)
- **MINTED token mock-1** = the server "minted" it (mock for now)

---

### Other keys to try

| Key | What it does |
|-----|-------------|
| B | Simulate a bid (main test) |
| 1 | Drop a sphere shape |
| 2 | Drop a torus shape |
| 3 | Drop a tetrahedron shape |
| 9 | Force capture the current frame |
| 0 | Download the mint log as a JSON file |

---

## PART 4 — Check your saved files

After pressing B a few times, open Finder/Explorer and look in:
```
cosmic-emergence/
  bidders-edition/
    captures/     ← PNG images (one per bid)
    metadata/     ← JSON files (one per bid, contains NFT attributes)
    mint-log.json ← log of everything that happened
```

Open one of the PNG files — this is what would be minted as the Bidder's Edition NFT.

Open one of the JSON files — this is the NFT metadata. It should look like:
```json
{
  "name": "Cosmic Emergence — Bidder's Edition #1",
  "description": "A moment captured by the on-chain agent...",
  "attributes": [
    { "trait_type": "Cosmic Phase", "value": "spiral" },
    { "trait_type": "Agent Peak Score", "value": 0.782 },
    ...
  ]
}
```

---

## PART 5 — If something goes wrong

**"Cannot find module 'ws'"**
→ You skipped Step 3. Go do it now.

**Animation opens but HUD says "BRIDGE ○ offline"**
→ The bridge isn't running. Open a new Terminal and do Window 1 steps again.

**"Port 3000 already in use"**
→ Try `npx serve . --listen 3001` instead, then open `http://localhost:3001`

**"Port 3131 already in use"**
→ Something else is using that port. Kill it: `lsof -ti:3131 | xargs kill`

**Nothing happens when I press B**
→ Click on the browser window first, then press B (lowercase, not Shift+B)

**The animation is black / nothing shows**
→ Your browser might be blocking WebGL. Try Chrome instead of Safari.

---

## STOPPING EVERYTHING

When you're done testing:
- In each Terminal window, press **Ctrl+C** to stop it
- Close the browser tab

---

## NEXT STEPS (after this works)

Once you've seen the captures folder fill up with images when you press B, you're ready for:

**Stage 2 — mint.day** (free gas, real blockchain)
- You'll upload one of the PNG captures to mint.day manually
- Just to prove the image looks good on-chain

**Stage 3 — Rare Protocol CLI** (the real pipeline)
- Install rare-cli
- Deploy two contracts (main animation + Bidder's Edition)
- Run a real Sepolia testnet auction
- The bridge will mint automatically when real bids come in

But first — get the B key working and see those PNG files appear. That's the whole goal of this stage.
