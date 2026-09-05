// Precompute the Bot's guess path for each seed day.
// Fixed opener + letter-frequency heuristic over the allowed list.
// Deterministic: same word -> same path for every player, every day.
const fs = require('fs');
const allowed = fs.readFileSync('data/allowed-guesses.txt','utf8').trim().split('\n');

function feedback(guess, answer){
  const res = Array(5).fill('absent');
  const counts = {};
  for (let i=0;i<5;i++){ const c=answer[i]; if (guess[i]!==c) counts[c]=(counts[c]||0)+1; }
  for (let i=0;i<5;i++) if (guess[i]===answer[i]) res[i]='correct';
  for (let i=0;i<5;i++){
    if (res[i]==='correct') continue;
    const c=guess[i];
    if (counts[c]>0){ res[i]='present'; counts[c]--; }
  }
  return res;
}
function filter(cands, guess, fb){
  return cands.filter(w => feedback(guess, w).join()===fb.join());
}
// static letter frequency over the allowed list
const freq = {};
for (const w of allowed) for (const ch of new Set(w)) freq[ch]=(freq[ch]||0)+1;
const score = w => [...new Set(w)].reduce((a,c)=>a+freq[c],0);

function solve(answer){
  const opener = 'salet';
  let cands = allowed.slice();
  const path = [];
  let guess = opener;
  for (let turn=0; turn<6; turn++){
    path.push({guess, fb: feedback(guess, answer)});
    if (guess===answer) return path;
    cands = filter(cands, guess, path[path.length-1].fb);
    if (!cands.length) return path; // shouldn't happen with real answers
    if (cands.length <= 60){
      // minimax: minimize worst-case remaining candidates
      let best = cands[0], bestWorst = Infinity, bestScore = -1;
      for (const g of cands){
        const buckets = {};
        for (const a of cands){ const k = feedback(g,a).join(); buckets[k]=(buckets[k]||0)+1; }
        const worst = Math.max(...Object.values(buckets));
        const sc = score(g);
        if (worst < bestWorst || (worst===bestWorst && sc>bestScore)){ best=g; bestWorst=worst; bestScore=sc; }
      }
      guess = best;
    } else {
      guess = cands.reduce((a,b)=> score(b)>score(a)?b:a);
    }
  }
  return path;
}

const seeds = [
  ['2026-09-05','crane'],['2026-09-06','plant'],['2026-09-07','globe'],
  ['2026-09-08','storm'],['2026-09-09','brick'],['2026-09-10','mango'],
  ['2026-09-11','pearl'],['2026-09-12','vault'],['2026-09-13','choir'],
];
const rows = seeds.map(([date, word], i) => {
  const path = solve(word);
  if (path.length>6 || path[path.length-1].guess!==word) throw new Error('solver failed on '+word);
  return {date, n: i+1, word, path};
});
for (const r of rows) console.log(r.date, r.word, 'bot solves in', r.path.length, '->', r.path.map(p=>p.guess).join(' '));
const stmts = rows.map(r =>
  `INSERT OR REPLACE INTO days (date, day_number, word, ai_path) VALUES ('${r.date}', ${r.n}, '${r.word}', '${JSON.stringify(r.path)}');`);
fs.writeFileSync('seed.sql', '-- Verse - seed days with precomputed Bot paths (node scripts/gen-seed.js)\n'+stmts.join('\n')+'\n');
console.log('seed.sql written');
