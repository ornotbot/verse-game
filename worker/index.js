// verse-seed - daily real-AI run generator for Verse.
// Cron: every day at 09:05 UTC, ensure rows exist for today/+1/+2 (UTC),
// each with a fresh, real LLM playthrough. Fetch /generate: on-demand
// (backfill) generation, guarded by a shared secret and a no-plays check.
import { playWord, MODEL_SETS } from './player.js';
import { ANSWERS, ALLOWED } from './wordlist.js';

const ALLOWED_SET = new Set(ALLOWED);

async function generateFor(env, date, word, dayNumber, modelSet) {
  if (!word) word = ANSWERS[(dayNumber - 1) % ANSWERS.length];
  if (!ALLOWED_SET.has(word)) throw new Error('word not in allowed list: ' + word);
  const { path, model, fallbacks } = await playWord(word, env.AI, MODEL_SETS[modelSet] || MODEL_SETS.llama);
  const solved = path[path.length - 1].fb.every((f) => f === 'correct');
  await env.DB.prepare('INSERT OR REPLACE INTO days (date, day_number, word, ai_path) VALUES (?,?,?,?)')
    .bind(date, dayNumber, word, JSON.stringify(path)).run();
  return { date, day_number: dayNumber, word, solved_in: solved ? path.length : 0, guesses: path.map((p) => p.guess), model, fallbacks };
}

async function nextDayNumber(env) {
  const r = await env.DB.prepare('SELECT MAX(day_number) AS m FROM days').first();
  return (r?.m || 0) + 1;
}

async function ensureDate(env, date) {
  const row = await env.DB.prepare('SELECT date FROM days WHERE date = ?').bind(date).first();
  if (row) return { date, skipped: true };
  const n = await nextDayNumber(env);
  return generateFor(env, date, null, n);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const out = [];
      for (let d = 0; d <= 2; d++) {
        const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
        try { out.push(await ensureDate(env, date)); } catch (e) { out.push({ date, error: String(e) }); }
      }
      console.log('verse-seed cron:', JSON.stringify(out));
    })());
  },

  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('POST only', { status: 405 });
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'bad_json' }, { status: 400 }); }
    if (!env.GEN_SECRET || body.secret !== env.GEN_SECRET) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const { date, word, day_number } = body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return Response.json({ error: 'bad_date' }, { status: 400 });
    const plays = await env.DB.prepare('SELECT COUNT(*) AS n FROM plays WHERE date = ?').bind(date).first();
    if ((plays?.n || 0) > 0) return Response.json({ error: 'plays_exist', plays: plays.n }, { status: 409 });
    const existing = await env.DB.prepare('SELECT day_number, word FROM days WHERE date = ?').bind(date).first();
    const dn = day_number || existing?.day_number || await nextDayNumber(env);
    const w = word || existing?.word || null;
    if (body.dry) {
      if (!w) return Response.json({ error: 'dry needs word' }, { status: 400 });
      try {
        const { path, model, fallbacks } = await playWord(w, env.AI, MODEL_SETS[body.model] || MODEL_SETS.llama);
        const solved = path[path.length - 1].fb.every((f) => f === 'correct');
        return Response.json({ date, word: w, solved_in: solved ? path.length : 0, guesses: path.map((p) => p.guess), model, fallbacks, dry: true });
      } catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
    }
    try {
      const res = await generateFor(env, date, w, dn, body.model);
      return Response.json(res);
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  },
};
