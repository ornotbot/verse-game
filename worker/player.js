// Verse - real AI playthrough harness.
// A real LLM plays the day's word: it guesses, the harness returns true
// color feedback, and it continues until it solves or busts at 6.
// Guardrails: guesses must be in the allowed list (2 reprompts, then a
// solver pick for that turn - a run never contains an invalid guess).
import { ALLOWED, ANSWERS } from './wordlist.js';

export function feedback(guess, answer) {
  const res = Array(5).fill('absent');
  const counts = {};
  for (let i = 0; i < 5; i++) { const c = answer[i]; if (guess[i] !== c) counts[c] = (counts[c] || 0) + 1; }
  for (let i = 0; i < 5; i++) if (guess[i] === answer[i]) res[i] = 'correct';
  for (let i = 0; i < 5; i++) {
    if (res[i] === 'correct') continue;
    const c = guess[i];
    if (counts[c] > 0) { res[i] = 'present'; counts[c]--; }
  }
  return res;
}

const ALLOWED_SET = new Set(ALLOWED);

// static letter frequency over the allowed list (for ranking + fallback solver)
const freq = {};
for (const w of ALLOWED) for (const ch of new Set(w)) freq[ch] = (freq[ch] || 0) + 1;
const score = (w) => [...new Set(w)].reduce((a, c) => a + freq[c], 0);

// candidate pool: every curated answer + the 4000 most plausible allowed words.
// Bounds CPU per turn while always containing the day's answer.
export const RANKED = [...new Set([...ANSWERS, ...ALLOWED.slice().sort((a, b) => score(b) - score(a))])];

function consistent(cands, guess, fb) {
  const key = fb.join();
  return cands.filter((w) => feedback(guess, w).join() === key);
}

// deterministic fallback pick (minimax over candidates when small, else frequency)
export function solverPick(cands) {
  if (!cands.length) return RANKED[0]; // unreachable when the answer is in ALLOWED
  if (cands.length <= 60) {
    let best = cands[0], bestWorst = Infinity, bestScore = -1;
    for (const g of cands) {
      const buckets = {};
      for (const a of cands) { const k = feedback(g, a).join(); buckets[k] = (buckets[k] || 0) + 1; }
      const worst = Math.max(...Object.values(buckets));
      const sc = score(g);
      if (worst < bestWorst || (worst === bestWorst && sc > bestScore)) { best = g; bestWorst = worst; bestScore = sc; }
    }
    return best;
  }
  return cands.reduce((a, b) => (score(b) > score(a) ? b : a));
}

const SYSTEM = `You are playing a daily word game, Wordle-style. The answer is a common 5-letter English word. You have 6 guesses.
After each guess you get per-letter feedback: C = right letter, right spot. P = letter is in the word, wrong spot. A = letter not in the word.
Play smart: use the feedback, keep letters marked C in place, move letters marked P, drop letters marked A.
Reply with ONLY your guess: one real 5-letter English word, lowercase, no punctuation, no explanation.`;

export const MODEL_SETS = {
  llama: [{ id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', maxTokens: 24, reasoning: false },
          { id: '@cf/meta/llama-3.1-8b-instruct', maxTokens: 24, reasoning: false }],
  r1: [{ id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', maxTokens: 900, reasoning: true },
       { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', maxTokens: 24, reasoning: false }],
};

async function ask(ai, messages, models) {
  let lastErr;
  for (const m of models) {
    try {
      const r = await ai.run(m.id, { messages, max_tokens: m.maxTokens, temperature: 0.6 });
      let text = (r && r.response) || '';
      if (m.reasoning) {
        // R1-style models emit a thinking trace; only the post-think text counts
        const i = text.indexOf('</think>');
        if (i >= 0) text = text.slice(i + 8);
      }
      // final answer tends to be last; prefer the last token that's an allowed word
      const toks = text.toLowerCase().match(/\b[a-z]{5}\b/g) || [];
      const word = [...toks].reverse().find((w) => ALLOWED_SET.has(w)) || toks[toks.length - 1];
      if (word) return { word, model: m.id };
      lastErr = new Error('unparseable: ' + text.slice(0, 60));
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Play one full game. Returns { path, model, fallbacks } where path = [{guess, fb}].
export async function playWord(answer, ai, models) {
  models = models || MODEL_SETS.llama;
  const messages = [{ role: 'system', content: SYSTEM }];
  const path = [];
  let cands = RANKED.slice();
  let model = null, fallbacks = 0;
  const mark = { correct: 'C', present: 'P', absent: 'A' };

  for (let turn = 0; turn < 6; turn++) {
    // harness-computed ground truth, spelled out so the model can't misread it
    const hist = path.map((p) => `${p.guess}: ${p.guess.split('').map((ch, i) => ch + '=' + mark[p.fb[i]]).join(' ')}`).join('\n');
    const known = ['_', '_', '_', '_', '_'];
    const present = {}, absent = new Set();
    for (const p of path) for (let i = 0; i < 5; i++) {
      const ch = p.guess[i];
      if (p.fb[i] === 'correct') known[i] = ch;
      else if (p.fb[i] === 'present') (present[ch] = present[ch] || new Set()).add(i + 1);
      else if (!known.includes(ch) && !present[ch]) absent.add(ch);
    }
    const summary = [
      known.some((k) => k !== '_') ? `Solved positions: ${known.join('')}` : null,
      Object.keys(present).length ? `Letters in the word but not where guessed: ${Object.entries(present).map(([c, s]) => `${c} (not position ${[...s].join('/')})`).join(', ')}` : null,
      absent.size ? `Letters NOT in the word: ${[...absent].join(', ')}` : null,
    ].filter(Boolean).join('\n');
    const sample = cands.slice(0, 40).join(', ');
    const prompt = path.length
      ? `Feedback so far (C=correct spot, P=in word wrong spot, A=not in word):\n${hist}\n${summary}\n${cands.length} allowed words still fit every clue, e.g.: ${sample}\nHard mode: your guess MUST fit every clue above. Guess ${turn + 1} of 6:`
      : 'No feedback yet. Make your opening guess (a strong opener with common letters).';
    messages.push({ role: 'user', content: prompt });

    let guess = null, why = '';
    for (let attempt = 0; attempt < 3 && !guess; attempt++) {
      if (attempt > 0) messages.push({ role: 'user', content: why + ' Reply with one allowed 5-letter English word that fits every clue, nothing else.' });
      try {
        const r = await ask(ai, messages, models);
        model = r.model;
        if (!ALLOWED_SET.has(r.word)) { why = `"${r.word}" is not in the allowed word list.`; continue; }
        const bad = path.find((p) => feedback(p.guess, r.word).join() !== p.fb.join());
        if (bad) { why = `"${r.word}" contradicts the feedback from ${bad.guess}.`; continue; }
        guess = r.word; messages.push({ role: 'assistant', content: guess });
      } catch (e) { why = 'Your reply was not a 5-letter word.'; }
    }
    if (!guess) { guess = solverPick(cands); fallbacks++; messages.push({ role: 'assistant', content: guess }); }

    const fb = feedback(guess, answer);
    path.push({ guess, fb });
    if (guess === answer) break;
    cands = consistent(cands, guess, fb);
  }
  return { path, model, fallbacks };
}
