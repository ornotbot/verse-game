// GET /api/today?tz=Asia/Jerusalem
// Player-local date decides the day (same model as Bot or Not).
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const tz = url.searchParams.get("tz") || "UTC";
  let today;
  try {
    today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch {
    today = new Date().toISOString().slice(0, 10);
  }
  const row = await env.DB.prepare("SELECT date, day_number, word, ai_path FROM days WHERE date = ?")
    .bind(today).first();
  if (!row) {
    return Response.json({ error: "no_day", date: today }, { status: 404 });
  }
  const played = await env.DB.prepare("SELECT COUNT(*) AS n FROM plays WHERE date = ?")
    .bind(row.date).first();
  return Response.json({
    date: row.date,
    day_number: row.day_number,
    word: row.word,
    bot: JSON.parse(row.ai_path),
    players_today: played?.n || 0,
  });
}
