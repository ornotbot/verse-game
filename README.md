# Beat the Bot

A daily Wordle-style word duel against the Bot. Everyone gets the same 5-letter
word each day (player-local date). You guess, the Bot guesses alongside you in
real time - its scripted run reveals one guess after each of yours. Fewer
guesses wins. Shareable score: "I beat the Bot in 4."

Stack: Cloudflare Pages + Pages Functions + D1. Same platform as Bot or Not
and Agent Arena.

## How the Bot plays

The Bot does NOT call an LLM live. Its run is precomputed once per day by
`scripts/gen-seed.js` (deterministic solver: fixed opener "salet" +
letter-frequency midgame + minimax endgame over the allowed-guess list) and
stored in D1 (`days.ai_path`). Every player that day races the same stored run.
One computation per day, zero per-player cost, no latency, provably fair.

- The Bot's guess N reveals ~2.5s after your guess N lands.
- You solve in fewer guesses than the Bot's stored run: **win**. Same count: **tie**.
  The Bot finishes first, or you don't solve in 6: **loss**.
- One play per browser per day (`plays` PK on anon_id+date); replays don't count.

## Data

- `days(date, day_number, word, ai_path)` - seeded from `seed.sql` (generated).
- `plays(anon_id, date, guesses_json, result, num_guesses, ts)`.

## API

- `GET /api/today?tz=` - the day row + Bot path + player count.
- `POST /api/submit` `{anon_id, date, guesses, result}` - INSERT OR IGNORE, returns
  real player stats (display-gated below 100 players: "Be one of the first today.").

## Content

Seed days are generated: edit the word list in `scripts/gen-seed.js`, run
`node scripts/gen-seed.js` (writes seed.sql), then
`npx wrangler d1 execute DB --remote --file seed.sql`. Answers must be in
`data/allowed-guesses.txt` and the solver must solve them within 6 (the script
enforces both).

## Deploy

`wrangler pages deploy` after creating the D1 database and filling its id into
wrangler.toml; or wire the repo to a Pages project with main as the production
branch for auto-deploy on push.
