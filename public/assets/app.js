(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    anon: null, day: null, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    guesses: [], cur: "", over: false, result: null, botShown: 0, botTimer: null,
  };
  const keyOf = (d) => `verse_${d}`;

  function anonId() {
    let a = localStorage.getItem("verse_anon");
    if (!a) { a = crypto.randomUUID(); localStorage.setItem("verse_anon", a); }
    return a;
  }
  async function api(path, opts) {
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "request_failed"), { data });
    return data;
  }
  function show(id) {
    ["screen-landing", "screen-game", "screen-result"].forEach((s) => $(s).classList.toggle("active", s === id));
    window.scrollTo(0, 0);
  }
  function showToast(msg) {
    const el = $("toast"); el.textContent = msg; el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 2500);
  }
  function feedback(guess, answer) {
    const res = Array(5).fill("absent"), counts = {};
    for (let i = 0; i < 5; i++) if (guess[i] !== answer[i]) counts[answer[i]] = (counts[answer[i]] || 0) + 1;
    for (let i = 0; i < 5; i++) if (guess[i] === answer[i]) res[i] = "correct";
    for (let i = 0; i < 5; i++) {
      if (res[i] === "correct") continue;
      if (counts[guess[i]] > 0) { res[i] = "present"; counts[guess[i]]--; }
    }
    return res;
  }
  const emoji = { correct: "\u{1F7E9}", present: "\u{1F7E8}", absent: "\u2B1B" };

  // ---------- grids ----------
  function buildGrid(el, mini) {
    el.innerHTML = "";
    for (let r = 0; r < 6; r++) {
      const row = document.createElement("div"); row.className = "row";
      for (let c = 0; c < 5; c++) { const t = document.createElement("div"); t.className = "tile"; row.appendChild(t); }
      el.appendChild(row);
    }
  }
  function paintRow(gridEl, rowIdx, word, fb) {
    const row = gridEl.children[rowIdx]; if (!row) return;
    [...row.children].forEach((t, i) => {
      t.textContent = word[i] || "";
      t.classList.remove("filled", "correct", "present", "absent", "pop");
      if (fb) t.classList.add(fb[i]);
      else if (word[i]) t.classList.add("filled");
    });
  }

  // ---------- keyboard ----------
  const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  const keyState = {};
  function buildKeyboard() {
    const kb = $("keyboard"); kb.innerHTML = "";
    ROWS.forEach((r, ri) => {
      const row = document.createElement("div"); row.className = "kb-row";
      if (ri === 2) row.appendChild(mkKey("Enter", "wide"));
      [...r].forEach((ch) => row.appendChild(mkKey(ch)));
      if (ri === 2) row.appendChild(mkKey("Back", "wide", "\u232B"));
      kb.appendChild(row);
    });
  }
  function mkKey(ch, cls, label) {
    const b = document.createElement("button");
    b.className = "key" + (cls ? " " + cls : ""); b.textContent = label || ch; b.dataset.key = ch;
    b.type = "button";
    b.addEventListener("click", () => onKey(ch));
    return b;
  }
  function updateKeys(guess, fb) {
    const rank = { absent: 1, present: 2, correct: 3 };
    for (let i = 0; i < 5; i++) {
      const ch = guess[i], f = fb[i];
      if ((rank[keyState[ch]] || 0) < rank[f]) {
        keyState[ch] = f;
        const el = document.querySelector(`.key[data-key="${ch}"]`);
        if (el) { el.classList.remove("correct", "present", "absent"); el.classList.add(f); }
      }
    }
  }

  // ---------- input ----------
  function onKey(k) {
    if (state.over || !$("screen-game").classList.contains("active")) return;
    if (k === "Enter") return submitGuess();
    if (k === "Back") { state.cur = state.cur.slice(0, -1); }
    else if (/^[a-z]$/.test(k) && state.cur.length < 5) state.cur += k;
    paintRow($("grid-you"), state.guesses.length, state.cur, null);
  }
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") onKey("Enter");
    else if (e.key === "Backspace") onKey("Back");
    else if (/^[a-zA-Z]$/.test(e.key)) onKey(e.key.toLowerCase());
  });

  function msg(t) { const el = $("game-msg"); el.textContent = t || ""; el.classList.toggle("hidden", !t); }

  function submitGuess() {
    const g = state.cur;
    if (g.length < 5) return msg("Not enough letters");
    if (!WORDS.has(g)) return msg("Not in word list");
    msg("");
    const fb = feedback(g, state.day.word);
    state.guesses.push(g);
    state.cur = "";
    paintRow($("grid-you"), state.guesses.length - 1, g, fb);
    updateKeys(g, fb);
    const solved = g === state.day.word;
    scheduleBot();
    const n = state.guesses.length, botTotal = state.day.bot.length;
    if (solved) {
      // result settles after the Bot's matching guess reveals (tie detection)
      setTimeout(() => finish(n < botTotal ? "win" : n === botTotal ? "tie" : "loss"), 3200);
    } else if (n >= 6) {
      setTimeout(() => finish("loss"), 3200);
    }
  }

  // ---------- the Bot ----------
  function scheduleBot() {
    if (state.botShown >= state.day.bot.length) return;
    $("bot-status").textContent = "thinking\u2026";
    clearTimeout(state.botTimer);
    state.botTimer = setTimeout(() => {
      const i = state.botShown;
      const step = state.day.bot[i];
      paintRow($("grid-bot"), i, step.guess, step.fb);
      state.botShown++;
      if (state.botShown >= state.day.bot.length && !state.over) {
        // the Bot solved first (player still going)
        if (state.guesses.length < 6 && state.guesses[state.guesses.length - 1] !== state.day.word) {
          finish("loss");
          return;
        }
      }
      $("bot-status").textContent = state.botShown >= state.day.bot.length ? "done" : "";
    }, 2500);
  }

  // ---------- finish / persist ----------
  async function finish(result) {
    if (state.over) return;
    state.over = true;
    clearTimeout(state.botTimer);
    // make sure the Bot's full run is visible on the result
    for (let i = state.botShown; i < state.day.bot.length; i++) {
      paintRow($("grid-bot"), i, state.day.bot[i].guess, state.day.bot[i].fb);
    }
    state.botShown = state.day.bot.length;
    const solved = state.guesses[state.guesses.length - 1] === state.day.word;
    const num = solved ? state.guesses.length : 7;
    state.result = { result, num, guesses: state.guesses.slice() };
    localStorage.setItem(keyOf(state.day.date), JSON.stringify(state.result));
    if (result === "win") {
      const s = (parseInt(localStorage.getItem("verse_streak") || "0", 10) + 1);
      localStorage.setItem("verse_streak", String(s));
      localStorage.setItem("verse_streak_date", state.day.date);
    } else if (result === "loss") {
      localStorage.setItem("verse_streak", "0");
    }
    let stats = null;
    try {
      stats = await api("/api/submit", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ anon_id: state.anon, date: state.day.date, guesses: state.guesses, result }),
      });
    } catch { /* stats are nice-to-have */ }
    renderResult(stats);
    show("screen-result");
  }

  function gridText(guesses) {
    return guesses.map((g) => feedback(g, state.day.word).map((f) => emoji[f]).join("")).join("\n");
  }
  function headline() {
    const { result, num } = state.result;
    const botN = state.day.bot.length;
    if (result === "win") return `You beat the Bot in ${num}.`;
    if (result === "tie") return `Dead heat - both in ${num}.`;
    if (num === 7) return `The word was ${state.day.word.toUpperCase()}. The Bot took ${botN}.`;
    return `The Bot got there first - it took ${botN}.`;
  }
  function shareText() {
    const { result, num } = state.result;
    const botN = state.day.bot.length;
    const first =
      result === "win" ? `I beat the Bot in ${num}/6 (it took ${botN}).` :
      result === "tie" ? `Dead heat with the Bot - both in ${num}/6.` :
      `The Bot beat me - it took ${botN}/6.`;
    return [`Verse #${state.day.day_number}`, first, gridText(state.result.guesses)].join("\n");
  }
  function renderResult(stats) {
    $("result-line").textContent = headline();
    const rg = $("result-grids"); rg.innerHTML = "";
    const mk = (label, gridEl) => {
      const wrap = document.createElement("div");
      const l = document.createElement("div"); l.className = "col-label"; l.textContent = label;
      wrap.appendChild(l); wrap.appendChild(gridEl); return wrap;
    };
    const gy = document.createElement("div"); gy.className = "grid"; buildGrid(gy);
    state.result.guesses.forEach((g, i) => paintRow(gy, i, g, feedback(g, state.day.word)));
    const gb = document.createElement("div"); gb.className = "grid mini"; buildGrid(gb);
    state.day.bot.forEach((s, i) => paintRow(gb, i, s.guess, s.fb));
    rg.appendChild(mk("YOU", gy)); rg.appendChild(mk("THE BOT", gb));
    const st = $("result-stats");
    if (stats && stats.players_today >= 100 && stats.beat_pct != null) {
      st.textContent = `${stats.beat_pct}% of ${stats.players_today} players beat the Bot today.`;
    } else {
      st.textContent = "Be one of the first today.";
    }
    startCountdown();
  }

  function startCountdown() {
    const el = $("countdown");
    const tick = () => {
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: state.tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
      const g = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
      const left = 86400 - (g("hour") % 24) * 3600 - g("minute") * 60 - g("second");
      const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
      el.textContent = `New word in ${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };
    tick(); setInterval(tick, 1000);
  }

  // ---------- share card ----------
  function drawShare() {
    const cv = $("share-canvas"), ctx = cv.getContext("2d");
    const W = 1080, H = 1080;
    ctx.fillStyle = "#0f1115"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#253241"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(30, 30, W - 60, H - 60, 40); ctx.stroke();
    ctx.textAlign = "center"; ctx.fillStyle = "#f2f4f8";
    ctx.font = "800 64px -apple-system, Segoe UI, Arial";
    ctx.fillText(`Verse #${state.day.day_number}`, W / 2, 130);
    ctx.font = "800 52px -apple-system, Segoe UI, Arial";
    ctx.fillStyle = state.result.result === "win" ? "#2fbf71" : state.result.result === "tie" ? "#d4a017" : "#e5534b";
    ctx.fillText(headline(), W / 2, 210);
    const colors = { correct: "#2fbf71", present: "#d4a017", absent: "#3a4048" };
    const tile = 84, gap = 12;
    const drawGrid = (guesses, fbOf, cx, y0, ts) => {
      guesses.forEach((g, r) => {
        const fb = fbOf(g);
        const x0 = cx - (5 * ts + 4 * (ts / 7)) / 2;
        for (let c = 0; c < 5; c++) {
          ctx.fillStyle = colors[fb[c]];
          const x = x0 + c * (ts + ts / 7), y = y0 + r * (ts + ts / 7);
          ctx.beginPath(); ctx.roundRect(x, y, ts, ts, 10); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = `800 ${ts * 0.55}px -apple-system, Arial`;
          ctx.fillText(g[c].toUpperCase(), x + ts / 2, y + ts * 0.68);
        }
      });
    };
    ctx.fillStyle = "#9aa3b2"; ctx.font = "800 30px -apple-system, Arial";
    ctx.fillText("YOU", W / 4, 285); ctx.fillText("THE BOT", (3 * W) / 4, 285);
    drawGrid(state.result.guesses, (g) => feedback(g, state.day.word), W / 4, 310, tile);
    drawGrid(state.day.bot.map((s) => s.guess), (g) => state.day.bot.find((s) => s.guess === g).fb, (3 * W) / 4, 310, 44);
    ctx.fillStyle = "#9aa3b2"; ctx.font = "400 34px -apple-system, Arial";
    ctx.fillText("Same word. Same six guesses. Fewer wins.", W / 2, H - 90);
    return cv;
  }

  // ---------- share handlers ----------
  $("btn-share-x").addEventListener("click", () => {
    const intent = "https://twitter.com/intent/tweet?text=" +
      encodeURIComponent(shareText()) + "&url=" + encodeURIComponent(window.location.origin);
    window.open(intent, "_blank", "noopener");
  });
  $("btn-share-linkedin").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(shareText() + "\n" + window.location.origin); } catch {}
    showToast("Copied - paste it into the post");
    window.open("https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(window.location.origin), "_blank", "noopener");
  });
  $("btn-share-more").addEventListener("click", async () => {
    const cv = drawShare();
    cv.toBlob(async (blob) => {
      const file = new File([blob], `verse-${state.day.day_number}.png`, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text: shareText() }); return; } catch {}
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    }, "image/png");
  });

  // ---------- boot ----------
  $("btn-play").addEventListener("click", () => startGame(false));
  $("landing-played").addEventListener("click", () => startGame(true));

  function startGame(replay) {
    buildGrid($("grid-you")); buildGrid($("grid-bot")); buildKeyboard();
    Object.keys(keyState).forEach((k) => delete keyState[k]);
    state.guesses = []; state.cur = ""; state.botShown = 0; state.over = false;
    $("bot-status").textContent = "";
    if (replay) {
      const saved = state.result;
      saved.guesses.forEach((g, i) => {
        paintRow($("grid-you"), i, g, feedback(g, state.day.word));
        updateKeys(g, feedback(g, state.day.word));
      });
      state.day.bot.forEach((s, i) => paintRow($("grid-bot"), i, s.guess, s.fb));
      renderResult(null);
      show("screen-result");
      return;
    }
    show("screen-game");
    $("bot-status").textContent = "The Bot plays after your first guess.";
  }

  async function init() {
    state.anon = anonId();
    let day;
    try {
      day = await api("/api/today?tz=" + encodeURIComponent(state.tz));
    } catch (e) {
      $("landing-error").textContent = e.data?.error === "no_day" ? "No word scheduled today - check back soon." : "Couldn't load today's word.";
      $("landing-error").classList.remove("hidden");
      $("btn-play").disabled = true;
      return;
    }
    state.day = day;
    $("day-label").textContent = `Day #${day.day_number}`;
    const streak = parseInt(localStorage.getItem("verse_streak") || "0", 10);
    if (streak > 0 && localStorage.getItem("verse_streak_date")) {
      // streak survives only if yesterday was a win - cheap check: last win date is today or yesterday
      const last = localStorage.getItem("verse_streak_date");
      const d = new Date(day.date), l = new Date(last);
      const diff = (d - l) / 86400000;
      if (diff > 1) { localStorage.setItem("verse_streak", "0"); }
      else if (streak > 0) {
        $("landing-streak").textContent = `Streak vs the Bot: ${streak}`;
        $("landing-streak").classList.remove("hidden");
      }
    }
    const savedRaw = localStorage.getItem(keyOf(day.date));
    if (savedRaw) {
      state.result = JSON.parse(savedRaw);
      $("btn-play").classList.add("hidden");
      $("landing-played").classList.remove("hidden");
    }
  }
  init();
})();
