# AI: An Impostor

**One of the strangers isn't a person.**

An online social deduction game for Android. You're matched with strangers in a small chat room and given a conversation starter. Everyone answers in turn — and one seat is an AI pretending to be one of you. After each round the room votes someone out. Find the machine before it outlasts you.

Built with Expo (React Native) for [RevenueCat Shipaton 2026](https://revenuecat-shipaton-2026.devpost.com/).

## How a match works

- Pick a room size: **Duel** (2 people + the AI), **Quick** (3 + AI) or **Classic** (4 + AI), and tap *Find a game*.
- Every seat is dealt a colour name for the match — *Mr. Pink*, *Mr. Blue* — so nobody can be recognised and nothing typed about a player gives the AI away.
- The room answers a prompt, three messages each, 40 seconds a turn. Then everyone votes; the most-voted player is out. Ties go to a tiebreaker.
- Vote the AI out and the humans win. Let it whittle the room down, and it wins.

## The AI impostor

The whole game rests on one question: can a language model pass as a stranger typing on a phone? Most of the work in this project went into making the answer *yes, often*. The impostor runs on the server ([`server/impostor.js`](server/impostor.js)), on an open model through OpenRouter (Gemma by default) — the phones never see a key or a prompt.

**It is not told to act human — it is given a human to be.** Each match it is dealt a persona, a first name and a phone-sized typing window, and told not to *perform* being human. The word "AI" only comes up when somebody in the room accuses it of being one — so it can react the way an accused person would.

**It sees the room the way a player does.** Each turn it gets the prompt, this round's messages (and who replied to whom), who ran out of time or lost connection, what it said in earlier rounds, the recent past of the others, and every past vote ([`server/rules/impostor-payload.ts`](server/rules/impostor-payload.ts)).

**Every match it types like a different person.** Drawn once per match: how long its messages run, how often it makes typos, whether its phone auto-capitalises, even which topics it doesn't follow. Drawn per message: its length, whether it agrees or pushes back, how it answers being accused. About one match in twenty it commits to a bit for the whole match.

**What comes back is roughed up like thumb-typing.** Lowercased, em dashes and semicolons stripped, apostrophes dropped, the occasional swapped or missing letter, phone-style capitals put back. In a room that swears, it swears. A reply that names someone, repeats itself or claims to know a stranger's life is thrown away and asked for again.

**It keeps a human's timing.** It "sends" after a delay that grows with the length of the message, replies to someone once the room is actually talking, and very occasionally lets a turn pass — but never right after it has been called out ([`server/rules/humanlike.ts`](server/rules/humanlike.ts)).

**It votes to survive.** It won't vote for someone it just defended, follows through on anyone it accused, and otherwise joins the room's majority instead of making revenge votes.

**Nothing on screen gives it away.** Its seat id comes from the same generator as everyone's, turn order and colour names are shuffled, and the subscriber star is dealt to it at the same rate as the humans around it. If the model is slow or fails, a stock line goes out before the turn ends — the room never sees a seat stall.

## Monetization (RevenueCat)

Every match has a real language model in it, answering on each of its turns, so every match costs money to run. What players pay for is **more matches** — nothing about a match changes with a purchase, so the room can never tell who paid.

| Offer | Type | Price | Gives |
|---|---|---|---|
| Free | — | — | 3 matches every day, back at midnight |
| `matches_20` | Consumable | $2.99 | 20 matches, never expire |
| `matches_100` | Consumable | $9.99 | 100 matches, never expire |
| `Unlimited` | Monthly subscription | $4.99 / month | Unlimited matches while subscribed (`unlimited` entitlement) |

How it is built:

- **RevenueCat SDK** (`react-native-purchases`) is configured with the player's own id, so purchases belong to the same player the game server knows. See [`src/game/pro.ts`](src/game/pro.ts).
- **Offerings drive the shop.** The paywall ([`src/app/paywall.tsx`](src/app/paywall.tsx)) is drawn in the game's own style, but what is for sale and every price comes from the RevenueCat default offering, in the player's currency.
- **Entitlement for the subscription, transactions for the packs.** Unlimited is the `unlimited` entitlement (only while active); bought matches are counted from the consumable purchases in the customer's history. Free matches are spent first, bought ones after.
- **The paywall appears at the moment it matters** — tapping *Find a game* with no matches left opens it, and a purchase goes straight into the queue.
- **A red star for subscribers**, shown to the whole room. Because the AI can never subscribe, a star would prove a seat is human — so the server gives the AI a star at the same rate as the people in that room (`server/game/match.ts`). A star says nothing about who the impostor is.

Known shortcut: match usage is counted on the device, so a reinstall resets it. The next step is moving the count server-side (e.g. RevenueCat virtual currencies).

## Architecture

```
┌──────────────┐   WebSocket /game   ┌─────────────────────────────┐   HTTPS   ┌────────────┐
│  Expo app     │ ─────────────────▶ │  Game server (Node, ws)      │ ────────▶ │ OpenRouter │
│  (phones)     │ ◀───────────────── │  matchmaking · match rules   │           │  (the AI)  │
│  RevenueCat   │   room, filtered   │  timers · the impostor seat  │           └────────────┘
└──────────────┘   per player        └─────────────────────────────┘
```

- **The server is authoritative.** Matches run on the server; each phone gets only its own view of the room. Who the impostor is, other people's open votes and upcoming prompts are removed before anything is sent (`server/game/view.ts`).
- **The API key never reaches the app.** Only the server talks to the model.
- **Built for real phones:** a heartbeat detects silent drops, a dropped player is shown reconnecting to the room for 25 seconds, and whatever they had typed is posted for them if they don't come back. Leaving matches early earns a cooldown.
- The shared game rules live in `server/rules/`, imported by both the server and the app.

## Run it yourself

Requirements: Node 22.13+, an [OpenRouter](https://openrouter.ai) API key for the AI, and for purchases a [RevenueCat](https://www.revenuecat.com) project.

### 1. Install and configure

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...                        # the server's key for the AI
EXPO_PUBLIC_GAME_URL=ws://<your-computer's-LAN-IP>:8787/game
EXPO_PUBLIC_REVENUECAT_API_KEY=test_...               # optional, see step 4
```

### 2. Start the game server

```bash
npm run impostor:server
```

Or with Docker, from `server/`: `docker compose up -d --build`. It listens on port 8787 and prints the address to use for `EXPO_PUBLIC_GAME_URL`.

### 3. Start the app

```bash
npx expo start
```

A match needs 2–4 people queueing for the same room size, so use two phones or a phone and an emulator. Without `EXPO_PUBLIC_GAME_URL`, a development build plays the whole match on one device against bots.

### 4. Purchases (optional)

Real purchases need a **development build** — Expo Go only mocks RevenueCat, so the app switches the paywall and the match limit off there.

```bash
npx eas build --profile development --platform android
```

In the RevenueCat dashboard, with a **Test Store** app:

1. Create the products `matches_20` and `matches_100` (consumable) and `Unlimited` (monthly subscription).
2. Create the entitlement `unlimited` and attach only the subscription to it.
3. Add all three to the **default** offering.
4. Put the Test Store public key in `EXPO_PUBLIC_REVENUECAT_API_KEY`.

Test Store keys must never ship in a store build.

## Tests

```bash
npm test
```

Covers the match rules, what each phone is allowed to see, reconnects, matchmaking, penalties, the impostor's prompts and the red star's fairness.

## License

[MIT](LICENSE) © 2026 Nedim Muminovic
