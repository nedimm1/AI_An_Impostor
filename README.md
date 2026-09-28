# AI: An Impostor

**One of the strangers isn't a person.**

An online social deduction game for Android. You're matched with strangers in a small chat room, and one of them is an AI pretending to be one of you. Find the machine and vote it out before it outlasts you.

Built with Expo (React Native) for [RevenueCat Shipaton 2026](https://revenuecat-shipaton-2026.devpost.com/).

## Everything runs on a server

The app doesn't run the game on your phone. An online server runs every match:

- It matches strangers into rooms, keeps the timers and counts the votes.
- The AI plays from the server too. Only the server talks to the AI model, so your phone never sees the AI's instructions or the key used to run it.
- Each phone gets only what that player is allowed to see. Your phone is never told who the AI is, so you can't find out by digging into the app.

## Starting a match

1. **Choose a room size:**
   - **Duel:** 2 people and the AI
   - **Quick:** 3 people and the AI
   - **Classic:** 4 people and the AI
2. Tap **Find a game**. The server waits until enough real people have queued for that size, then puts everyone in a room and adds the AI.

## The aliases: a nod to *Reservoir Dogs*

Nobody types a name. When the room fills, every seat, including the AI's, is given a colour alias for that match only, like **Mr. Red**, **Mr. Blue**, **Mr. Pink** or **Mr. Gold**.

The aliases are a reference to Quentin Tarantino's *Reservoir Dogs*. In the film, a crew of strangers is given colour code names like Mr. White, Mr. Orange and Mr. Pink, and one of them is secretly an undercover cop. Here too, you're among strangers with colour names, and one of them isn't who they seem.

## A round

**1. Chat**

- The room gets a simple question, like *"What's your go‑to snack at 2am?"* Each round has a new question.
- Players answer **in turn**, **3 messages each**, with **40 seconds per turn**. You can reply to someone else's message.
- The starting player changes each round, so nobody always has to go first.
- Swear words are starred out.

**2. Vote**

- After the last message, everyone has **30 seconds** to vote for who they think is the AI, or to vote for nobody.
- Votes stay hidden until everyone has voted or time runs out, so you can't see which way the room is going and follow along. After that, everyone sees who voted for whom.

**3. Result**

The player with the most votes is out. There are three special cases:

- **If 2 players tie**, there's a **tiebreaker** (see below).
- **If 3 or more players tie**, nobody is out and the round is used up.
- **If nobody gets any votes**, nobody is out and the round is used up.

Players who are voted out stay and watch the rest of the match, but can't chat or vote.

## Tiebreaker

When 2 players tie:

1. The room is told who tied, and the chat opens again with the prompt *"It's between Mr. X and Mr. Y. Say your piece before the vote."*
2. **The 2 accused players go first in every pass** and get **4 messages each**. Everyone else gets 3. The accused also get the last word before the vote.
3. The room **votes again**. Anyone still in can be voted for, not just the 2 accused, in case the room decides both are innocent.
4. **If it ties again**, nobody is out and the round is used up. There's only one tiebreaker per round.

If one of the accused walks out during a tiebreaker, the other one isn't automatically voted out. Otherwise you could get someone removed just by leaving.

## Winning

- **The humans win** as soon as they vote out the AI.
- **The AI wins** when:
  - only **one human is left**, because one human can't outvote the AI, or
  - the room uses up **4 rounds** without catching it.

Every human voted out by mistake brings the AI closer to winning.

## Disconnects

- If your phone loses connection, your seat is held for **25 seconds**. The room sees that you're reconnecting.
- If you don't come back in time, whatever you had typed is sent for you and the match carries on without you.

## How the AI works

The AI is a language model (Gemma, reached through OpenRouter) that plays one seat in the room. It runs on the game server ([`server/impostor.js`](server/impostor.js)), not on anyone's phone. It isn't told to "act human". It's given a person to be, and its job is to type like a real stranger on a phone.

### It gets a person to be

- **An identity:** each match it's given a made‑up person, like *"26, shares a flat, works shifts in a warehouse"* or *"19, first year at uni, plays five‑a‑side badly"*. It also gets a real first name and a gender, and it sticks to them all match.
- **Topics it doesn't follow:** each match it randomly doesn't follow 2 topics, such as anime, football, horror or reality TV. If the room starts talking about one, it says so like a normal person would: *"idk i dont really watch anime"*. It can also simply not have seen a particular show: *"never seen it"*, *"i only got through s1 tbh"*.
- **A running joke, 1 match in 20:** sometimes it commits to a bit for the whole match, even when it's accused. Examples:
  - pirate: *"arr i be partial to a bit o pasta"*
  - conspiracy theorist: *"this whole chat is a data harvest"*
  - football commentator
  - Gen‑Alpha slang: *"no cap"*, *"mid"*, *"cooked"*, *"aura"*
  - astrology
  - uwu
  - Victorian gentleman
  - pretending not to speak English: *"que? no entiendo"*

### It types like someone on a phone

Every message the model writes is put through a filter before the room sees it.

**It uses slang and short forms, but not in every message:**

- casual words and abbreviations: *yeah, nah, lol, tbh, idk, same, omg, fax, imma*
- short replies to agree: *"yeah exactly"*, *"same"*, *"this is the correct answer"*
- dodging a question it has nothing for: *"got nothing for this one tbh"*, *"cant cook at all lol"*
- it leaves words out the way people do on a phone, and sometimes gets the grammar a bit wrong

**Typos:** each match it's randomly a clean, average or messy typer. In a messy message it might:

- swap two letters or drop one letter (*"teh"*, *"somthing"*)
- drop an apostrophe (*dont*, *im*, *cant*)
- leave off the full stop at the end

It never puts a typo in a player's name.

**Punctuation and capitals:**

- It never uses the punctuation that gives an AI away: no em dashes, semicolons or neat quotation marks.
- In 9 matches out of 10 it capitalises the way a phone keyboard auto‑corrects: the first letter and "I".
- In the other 1 in 10 it types all lowercase, like someone with autocorrect off.

**Message length:**

- Each match it's randomly a short‑texter, an average texter or a talker.
- It keeps an eye on how long everyone else's messages are and stays close to that. If the room is sending 4‑word replies, it won't write a paragraph.
- It never sends two one‑word messages in a row.

**Swearing:**

- It swears only if the room is swearing. Then it uses the real words and short forms like *wtf, ffs, af, bs*, never softened versions like "frick".
- It won't start swearing in a clean room.

**Keyboard mashing:** if people start mashing the keyboard (*"asdjfhkasd"*), it either mashes back or reacts like a confused person: *"lol what"*, *"why are we doing this"*.

**Messages that fail its checks are rewritten:**

- repeating itself
- claiming to know things about someone's life it couldn't know, like *"yours must be…"*
- asking something that was already answered
- using someone's name when it shouldn't

### It reads the room

**What it sees:** each turn it gets the same information a player would have ([`server/rules/impostor-payload.ts`](server/rules/impostor-payload.ts)):

- the question and every message this round, including who replied to whom
- who ran out of time or lost connection
- who has been voted out
- every vote so far
- what it and others said in earlier rounds

**Reading the mood:** it notices when the room is:

- joking around
- being sarcastic
- arguing
- swearing
- busy guessing *"who is it?"*

and it adapts. For example, if the room has gone silly, a serious answer would stand out, so it gets silly too.

**Replying to people:**

- If someone talks to it, it usually answers them, and it uses something from their message instead of repeating it back.
- Otherwise it's more likely to reply to messages that name it, ask a question or disagree with something.
- Sometimes it just gives its own answer, like people do.

**Taking sides:** in a round it may:

- give its own answer
- agree or disagree with someone
- build on someone else's point
- go off on a tangent
- back someone up in an argument
- join in on a suspect, or doubt an accusation: *"nah hes not the bot"*

**Names:** it mostly avoids using people's aliases, like strangers do. It uses them when it matters, like accusing someone or pushing for a vote.

**When it's accused:**

- It reacts like an annoyed person, not a polite assistant. It might brush it off (*"lol no"*, *"why would u think that"*), get irritated, or turn it back on someone.
- It says "I'm not the AI" at most once and doesn't over‑explain.
- When it turns the blame on someone, it picks a believable target: the person accusing it, the quietest player, or whoever it's tied with in a tiebreaker.

**Pushing a vote:** it can steer the room toward a suspect (*"i think imma vote Mr. Blue"*). It points to what that player actually said, and it keeps accusing the same person instead of switching around.

**If asked why it voted a certain way,** it shrugs like a person would: *"idk i didnt know who else to vote for"*, *"had to be someone"*.

### It votes to survive

- If it accused someone this round, it votes for them.
- It never votes for someone it just defended.
- Otherwise it goes along with the room's majority. It avoids a vote nobody else would make, and avoids voting for whoever accused it, because that looks like revenge.
- Its vote is hidden until voting closes, the same as everyone's.

### It keeps human timing

See [`server/rules/humanlike.ts`](server/rules/humanlike.ts).

- **Typing time:** it "types" before sending, and longer messages take longer. The time varies randomly like a real person's, but it always sends before its 40 seconds run out.
- **Skipped turns:** very rarely (about 1.5% of turns) it lets a turn pass like someone distracted. It never skips right after being called out.
- **Voting time:** it takes a human amount of time to vote, and occasionally doesn't vote at all.
- **Backup message:** if the model is slow or fails, a normal‑looking message is sent in time, so its seat never freezes.

### Nothing on screen gives it away

- Its seat, colour alias and place in the turn order look exactly like everyone else's.
- It gets the subscriber red star as often as the humans in that room have it.
- Your phone is never told which seat is the AI. Only the server knows.

## Monetization (RevenueCat)

Every match has a real AI in it, and every message it writes costs money to run, so what players pay for is **more matches**. Paying never changes how a match plays, so the room can't tell who paid.

**What's on offer:**

- **Free:** 3 matches every day, reset at midnight.
- **20 matches for $2.99** (`matches_20`): a one‑time purchase. The matches never expire.
- **100 matches for $9.99** (`matches_100`): a one‑time purchase. The matches never expire.
- **Unlimited for $4.99 a month** (`Unlimited`, entitlement `unlimited`): a monthly subscription. Unlimited matches while subscribed, plus a red star.

**How it works:**

- **The RevenueCat SDK runs every purchase.** `react-native-purchases` is set up with the player's own id, so purchases belong to the same player the game server knows ([`src/game/pro.ts`](src/game/pro.ts)).
- **I use RevenueCat's Test Store.** This is a student entry that isn't published in an app store, so purchases go through RevenueCat's Test Store. The full purchase flow is real: the shop, buying, unlocking matches and the subscription. No real money is charged.
- **The shop reads everything from RevenueCat.** The paywall ([`src/app/paywall.tsx`](src/app/paywall.tsx)) is drawn in the game's own style, but what's for sale and every price come from the RevenueCat default offering, in the player's currency.
- **Entitlement for the subscription, transactions for the packs.** Unlimited is the `unlimited` entitlement, only while it's active. Bought matches are counted from the one‑time purchases in the customer's history.
- **Free matches are used first,** then bought matches.
- **The shop opens exactly when you need it.** If you tap *Find a game* with no matches left, it opens, and after you buy you go straight into the queue.
- **The red star:** subscribers get a red star everyone in the room can see. Since the AI can't subscribe, a star would prove a seat is human, so the server gives the AI a star as often as the humans in that room have one ([`server/game/match.ts`](server/game/match.ts)). A star never tells you who the AI is.

Known shortcut: match usage is counted on the device, so a reinstall resets it. The next step is moving the count to the server, for example with RevenueCat virtual currencies.

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
