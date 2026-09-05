-- Beat the Bot - D1 schema
CREATE TABLE IF NOT EXISTS days (
  date TEXT PRIMARY KEY,          -- game day, YYYY-MM-DD (player-local date key)
  day_number INTEGER NOT NULL,
  word TEXT NOT NULL,             -- the daily 5-letter answer
  ai_path TEXT NOT NULL           -- JSON array of {guess, fb:[correct|present|absent x5]} - the Bot's scripted run
);

CREATE TABLE IF NOT EXISTS plays (
  anon_id TEXT NOT NULL,
  date TEXT NOT NULL,
  guesses_json TEXT NOT NULL,     -- JSON array of the player's guesses
  result TEXT NOT NULL,           -- 'win' | 'tie' | 'loss' (vs the Bot)
  num_guesses INTEGER NOT NULL,   -- guesses used (7 = failed)
  ts INTEGER NOT NULL,
  PRIMARY KEY (anon_id, date)
);
CREATE INDEX IF NOT EXISTS idx_plays_date ON plays(date);
