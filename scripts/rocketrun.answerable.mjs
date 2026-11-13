// Is every prompt RocketRun can ask genuinely answerable, with plenty of
// answers? Searches MusicBrainz for each template (two parameter draws each).
//   node scripts/rocketrun.answerable.mjs
import { questionsFor, dayNumber } from '../assets/rocketrun-rules.js';
import { findAnswers } from './rocketrun-mb.mjs';

const seen = new Map();
for (let d = dayNumber(); seen.size < 60 && d < dayNumber() + 4000; d++) {
  for (const q of questionsFor(d)) {
    const list = seen.get(q.tpl) || [];
    if (list.length < 2 && !list.some((x) => x.text === q.text)) { list.push(q); seen.set(q.tpl, list); }
  }
}
let bad = 0;
for (const [tpl, qs] of seen) for (const q of qs) {
  const { count, answers } = await findAnswers(q, 3);
  const ok = answers.length >= 2 && count >= 50;
  if (!ok) bad++;
  console.log(ok ? 'ok  ' : 'FAIL', tpl.padEnd(13), String(count).padStart(8), ' ', q.text, ' e.g.', answers.map((f) => f.title || f.name).slice(0, 2).join(' / '));
}
console.log(bad ? `${bad} prompt(s) without enough answers` : 'every template answerable');
process.exit(bad ? 1 : 0);
