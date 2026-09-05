// POST /api/submit {anon_id, date, guesses:[...], result:'win'|'tie'|'loss'}
// One play per anon per day (first play counts - INSERT OR IGNORE).
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  const { anon_id, date, guesses, result } = body || {};
  if (!anon_id || !date || !Array.isArray(guesses) || !["win", "tie", "loss"].includes(result)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (guesses.length < 1 || guesses.length > 6 || guesses.some((g) => typeof g !== "string" || !/^[a-z]{5}$/.test(g))) {
    return Response.json({ error: "bad_guesses" }, { status: 400 });
  }
  const day = await env.DB.prepare("SELECT word FROM days WHERE date = ?").bind(date).first();
  if (!day) return Response.json({ error: "no_day" }, { status: 404 });
  const solved = guesses[guesses.length - 1] === day.word;
  const num = solved ? guesses.length : 7;
  const ins = await env.DB.prepare(
    "INSERT OR IGNORE INTO plays (anon_id, date, guesses_json, result, num_guesses, ts) VALUES (?,?,?,?,?,?)"
  ).bind(anon_id, date, JSON.stringify(guesses), result, num, Math.floor(Date.now() / 1000)).run();
  const stats = await env.DB.prepare(
    "SELECT COUNT(*) AS n, SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) AS wins FROM plays WHERE date = ?"
  ).bind(date).first();
  return Response.json({
    ok: true,
    counted: (ins.meta?.changes || 0) > 0,
    players_today: stats?.n || 0,
    beat_pct: stats?.n ? Math.round((100 * (stats.wins || 0)) / stats.n) : null,
  });
}
