// RocketRun — the daily music run, inside VINALL's Arcade.
// Renderer, sprites, sound and layout are the prototype's (world.js, pixels.js,
// audio.js, style.css). What changed: the prompts, the catalogue, the rarity
// and the score now come from /api/rocketrun and MusicBrainz, not a local list.
import { GRADES, evaluate, dayNumber, dayLabel } from '../../assets/rocketrun-rules.js';
import { ENVIRONMENTS, environmentAt } from './data.js';
import { RocketWorld } from './world.js';
import { FlightAudio } from './audio.js';
import { drawLogo, rocketSprite } from './pixels.js';
import * as net from './net.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.floor(n).toLocaleString('en-GB');
const LAB = new URLSearchParams(location.search).has('lab');
const audio = new FlightAudio();
let state = { mode: 'boot', day: null, questions: [], question: 0, answers: [], selected: null, total: 0, busy: false, demo: false, lastGrade: 2, lastFrom: 0, finished: false, streak: 0, best: 0, award: 0, signedIn: false, error: '' };
let active = -1, options = [], envName = 'Neon City', lastPaint = 0, searchTimer = 0, searchSeq = 0;
const rocketURI = rocketSprite().toDataURL();
const gradeOf = (g) => GRADES[Math.max(0, g)];
document.documentElement.classList.toggle('embedded', !!net.host);

$('#app').innerHTML = `
<aside class="cabinet cabinet-left"><button class="vinall-word" id="exit-side" type="button" aria-label="Back to the Arcade"><span class="vinyl"></span> VINALL</button><div class="cabinet-copy"><span class="small-kicker">THE DAILY MUSIC RUN</span><h1>Deep cuts.<br>Great heights.</h1><p>Five music prompts.<br>Any record ever made.</p><div class="how-it-works"><span>01 <b>Name an album or artist</b></span><span>02 <b>Go for the deep cuts</b></span><span>03 <b>Watch your taste take off</b></span></div></div><button id="help" class="quiet-button">How to play <span>?</span></button><small class="standalone-note">Answers are checked against MusicBrainz,<br>the open music encyclopedia (CC0).</small></aside>
<main class="game-shell" aria-label="RocketRun">
  <div id="world"></div><div class="scanlines" aria-hidden="true"></div><div class="screen-vignette" aria-hidden="true"></div>
  <header class="game-nav"><div class="nav-left"><button id="exit" class="pixel-icon" aria-label="Back to the Arcade">←</button><div class="question-chip"><span class="vinyl"></span><span id="question-count">DAILY RUN</span></div></div><div class="nav-buttons"><button id="board" class="pixel-icon" aria-label="Leaderboard">▥</button><button id="sound" class="pixel-icon" aria-label="Turn sound on" aria-pressed="false">♪<span class="mute-slash">╱</span></button><button id="pause" class="pixel-icon" aria-label="Pause game">Ⅱ</button><button id="mobile-help" class="pixel-icon" aria-label="How to play">?</button></div></header>
  <div class="vinall-sign">✦ VINALL ✦</div>
  <section class="title-screen"><canvas id="logo" aria-label="RocketRun"></canvas><p>— DAILY MUSIC RUN —</p></section>
  <section class="altitude-hud" aria-label="Altitude"><span>ALTITUDE</span><div><strong id="altitude">0</strong><small>m</small></div><div class="run-track" role="progressbar" aria-label="Run progress" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0"><div id="track-fill"></div>${Array.from({ length: 20 }, () => '<i></i>').join('')}<img id="track-rocket" src="${rocketURI}" alt=""/><span class="finish-flag">⚑</span></div></section>
  <section id="panel" class="flight-panel" aria-label="Game controls"></section>
  <div id="rarity-reveal" class="rarity-reveal" aria-live="polite"></div>
  <div id="zone-toast" class="zone-toast" aria-live="polite"></div>
  <div class="environment-tag"><span class="tiny-diamond">◆</span><span id="environment">Neon City</span><span class="environment-line"></span></div>
  <footer class="game-footer"><a href="https://musicbrainz.org" target="_blank" rel="noopener">DATA · MUSICBRAINZ</a>${LAB ? '<button id="demo-toggle">FLIGHT LAB <kbd>D</kbd></button>' : '<span id="streak-chip"></span>'}</footer>
  ${LAB ? '<aside id="dev" class="dev-panel pixel-frame" hidden aria-label="Developer flight lab"></aside>' : ''}
  <section id="pause-overlay" class="pause-overlay" hidden aria-label="Paused game"><div class="pause-card pixel-frame"><span class="small-kicker">GROUND CONTROL</span><h2>FLIGHT PAUSED</h2><button id="resume" class="primary">RESUME <span>▶</span></button><button id="quit" class="secondary">BACK TO THE ARCADE</button></div></section>
</main>
<aside class="cabinet cabinet-right"><div class="today-date"><span id="side-date"></span><span>FLIGHT PLAN / 05 PROMPTS</span></div><div class="destination-list">${ENVIRONMENTS.map((e, i) => `<div class="destination ${i === 0 ? 'current' : ''}" data-env="${e.name}"><i></i><span>${e.name}<small>${fmt(e.altitude)} m</small></span></div>`).join('')}</div><div class="fuel-guide"><span class="small-kicker">YOUR TASTE IS ROCKET FUEL</span>${GRADES.map((g, i) => `<div style="--grade:${g.color}"><span>${'◆'.repeat(Math.min(3, i + 1))}</span><strong>${g.name}</strong><b>+${fmt(g.gain)}</b></div>`).join('')}</div><p class="keyboard-tip">Sound on for the full experience.<br><kbd>Esc</kbd> pause</p></aside>
<dialog id="help-dialog" class="pixel-frame"><button class="dialog-close pixel-icon" aria-label="Close instructions">×</button><span class="small-kicker">MISSION BRIEFING</span><h2>Your taste is<br>rocket fuel.</h2><p>Five prompts a day, the same five for everybody. Type any album or artist that fits; the search covers MusicBrainz, the open music encyclopedia, so obscure records count too.</p><p>The fewer players who gave your answer today, the further you fly. Early in the day, before enough people have played, rarity is an estimate from how widely MusicBrainz users know the record.</p><div class="help-grades">${GRADES.map((g) => `<div><b style="color:${g.color}">${g.name}</b><span>+${fmt(g.gain)} m</span></div>`).join('')}</div><p class="fineprint">One run a day, no timer. You can’t use the same answer twice. Stuck? Pass a prompt for 0 m. If MusicBrainz doesn’t list a record, it can’t be checked, so it can’t score — tell us and pick another. New prompts at midnight UTC.</p><button id="got-it" class="primary">READY FOR LIFTOFF <span>▶</span></button></dialog><div class="notice" id="notice" role="status"></div>`;
drawLogo($('#logo'));
const world = new RocketWorld($('#world'), updateHUD);
if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'none') world.reduced = true;

function notice(msg) { const n = $('#notice'); n.textContent = msg; n.classList.add('visible'); clearTimeout(notice.t); notice.t = setTimeout(() => n.classList.remove('visible'), 4000); }
function updateHUD({ altitude, boost, progress, fps }) {
  const now = performance.now(); if (now - lastPaint < 65) return; lastPaint = now;
  $('#altitude').textContent = fmt(altitude);
  const fraction = Math.min(5, state.busy && !state.demo ? state.answers.length - 1 + progress : state.answers.length) / 5;
  $('#track-fill').style.width = `${fraction * 100}%`; $('#track-rocket').style.left = `${fraction * 100}%`;
  $('.run-track').setAttribute('aria-valuenow', Math.min(5, state.answers.length));
  document.documentElement.style.setProperty('--boost', boost);
  const env = environmentAt(altitude);
  if (env.name !== envName) {
    envName = env.name; $('#environment').textContent = env.name;
    document.querySelectorAll('[data-env]').forEach((e) => e.classList.toggle('current', e.dataset.env === env.name));
    const toast = $('#zone-toast'); toast.innerHTML = `<small>ENTERING</small><span>${env.name}</span>`; toast.classList.remove('visible'); void toast.offsetWidth; toast.classList.add('visible');
  }
  if ($('#lab-fps')) $('#lab-fps').textContent = `${Math.round(Math.min(fps, 240))} FPS · CANVAS 2D`;
  if (state.mode === 'flight') {
    $('#panel').classList.toggle('flight-quiet', progress > 0.45);
    if (progress > (world.reduced ? 0.65 : 0.40)) $('#rarity-reveal').classList.remove('show');
  }
}

/* ---- loading the day ------------------------------------------------------- */

async function boot() {
  state.mode = 'boot'; state.error = ''; renderPanel();
  try {
    state.signedIn = await net.signedIn();
    const d = state.signedIn ? await net.getState() : await net.getDay();
    state.day = d.day; state.questions = d.questions;
    $('#side-date').textContent = dayLabel(d.day);
    const answers = (d.answers || []).map((a) => ({ id: a.key ? a.key.slice(3) : null, label: a.label, sub: a.sub, grade: a.grade, gain: a.gain, pct: a.pct, sample: a.sample }));
    Object.assign(state, { answers, question: answers.length, total: d.total || 0, finished: !!d.finished, streak: d.streak || 0, best: d.best || 0, award: d.awarded || 0, selected: null, busy: false });
    world.jump(state.total);
    state.mode = state.finished ? 'results' : 'menu';
  } catch (e) {
    state.mode = 'error'; state.error = e.message || 'RocketRun couldn’t reach VINALL.';
  }
  paintStreak(); renderPanel();
}
function noteHost() { try { net.host.RocketRunHost.note({ day: state.day, total: state.total, finished: state.finished, streak: state.streak, answers: state.answers }); } catch (e) {} }
function paintStreak() { noteHost(); const c = $('#streak-chip'); if (c) c.textContent = state.streak ? `STREAK ${state.streak}` : ''; }
net.onAuth(async () => { const s = await net.signedIn(); if (s !== state.signedIn && !state.busy) boot(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.day != null && dayNumber() !== state.day && !state.busy && ['menu', 'results'].includes(state.mode)) boot();
});

/* ---- panels ------------------------------------------------------------------ */

function nextRunIn() {
  const ms = Date.UTC(2020, 0, 1) + (dayNumber() + 1) * 86400000 - Date.now();
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
function renderPanel() {
  const panel = $('#panel'); document.body.dataset.mode = state.mode === 'boot' || state.mode === 'error' ? 'menu' : state.mode;
  world.setLayout(document.body.dataset.mode); panel.className = 'flight-panel';
  $('#question-count').textContent = ['play', 'flight'].includes(state.mode) ? `${Math.min(state.question + 1, 5)} / 5` : (state.streak ? `STREAK ${state.streak}` : 'DAILY RUN');
  if (state.mode === 'boot') {
    panel.innerHTML = `<div class="menu-card pixel-frame rr-loading"><span class="card-tab">DAILY</span><h2>Fuelling up…</h2><p>Loading today’s flight plan.</p></div>`;
  } else if (state.mode === 'error') {
    panel.innerHTML = `<div class="menu-card pixel-frame"><span class="card-tab">GROUND CONTROL</span><h2>No signal.</h2><p>${esc(state.error)}</p></div><button id="retry" class="primary launch-button">TRY AGAIN <span>↻</span></button>`;
    $('#retry').onclick = boot;
  } else if (state.mode === 'menu') {
    const started = state.answers.length > 0;
    panel.innerHTML = `<div class="menu-card pixel-frame"><span class="card-tab">DAILY · ${esc(dayLabel(state.day).toUpperCase())}</span><h2>Good taste.<br>Great heights.</h2><p>Five prompts. Any album or artist ever released.<br>The rarer your answer, the further you fly.</p><span class="menu-detail">${started ? `${state.answers.length} OF 5 ANSWERED · ${fmt(state.total)} M` : 'ONE RUN A DAY. NO TIMER.'}</span></div>${
      state.signedIn
        ? `<button id="start" class="primary launch-button">${started ? 'CARRY ON' : 'LET’S LAUNCH'} <span>▶</span></button><p class="start-note">${state.best ? `Your best: ${fmt(state.best)} m` : 'Your rocket is ready. Are you?'}</p>`
        : `<button id="signin" class="primary launch-button">LOG IN TO FLY <span>▶</span></button><p class="start-note">Runs, streaks and the leaderboard live on your VINALL account.</p>`}`;
    if ($('#start')) $('#start').onclick = startRun;
    if ($('#signin')) $('#signin').onclick = () => { audio.click(); net.login(); };
  } else if (state.mode === 'play') {
    const q = state.questions[state.question];
    const album = q.kind === 'album';
    panel.innerHTML = `<div class="question-card pixel-frame"><span class="card-tab">Q${String(state.question + 1).padStart(2, '0')} / 05</span><div class="question-kind">${album ? '♫' : '♪'} <span>${album ? 'ALBUM' : 'ARTIST'}</span><span class="rr-tier">${'◆'.repeat(q.tier)}</span></div><h2>${esc(q.text)}</h2><p class="question-hint">${esc(q.hint)}</p><form id="answer-form" autocomplete="off"><div class="search-wrap"><span class="search-icon" aria-hidden="true">⌕</span><input id="answer" role="combobox" enterkeyhint="search" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Search ${album ? 'albums' : 'artists'}" aria-autocomplete="list" aria-expanded="false" aria-controls="suggestions" placeholder="${album ? 'Album, or artist and album…' : 'Type an artist…'}"/><button type="button" id="clear-search" aria-label="Clear answer" hidden>×</button><kbd>↵</kbd></div><div id="suggestions" class="suggestions pixel-frame" role="listbox" hidden></div><div id="answer-error" class="answer-error" role="alert"></div><button class="primary" type="submit" id="launch-answer">LAUNCH <span>▶</span></button></form><button id="pass" class="browse-button">Stuck? Pass this one for 0 m</button></div><p class="fuel-tip">✦ DEEP CUTS GET YOU FURTHER ✦</p>`;
    const input = $('#answer');
    input.addEventListener('input', () => { state.selected = null; $('#answer-error').textContent = ''; $('#clear-search').hidden = !input.value; queueSearch(); });
    input.addEventListener('focus', () => { if (input.value && options.length) openList(); });
    input.addEventListener('keydown', handleKeys);
    $('#answer-form').onsubmit = (e) => { e.preventDefault(); submitAnswer(); };
    $('#clear-search').onclick = () => { state.selected = null; input.value = ''; $('#clear-search').hidden = true; options = []; closeOptions(); input.focus(); };
    $('#pass').onclick = passQuestion;
  } else if (state.mode === 'flight') {
    const a = state.demo ? null : state.answers.at(-1);
    panel.innerHTML = `<div class="answer-accepted pixel-frame"><span>✓</span><div>${esc(a ? a.label : 'Flight lab ignition')}<small>${esc(a ? a.sub : 'Developer sequence')}</small></div></div>`;
  } else if (state.mode === 'results') {
    const env = environmentAt(state.total);
    panel.innerHTML = `<div class="results-card pixel-frame"><span class="card-tab">MISSION COMPLETE</span><span class="result-stars">✦ ✦ ✦</span><h2>TASTE. ELEVATED.</h2><div class="results-altitude">${fmt(state.total)}<small>m</small></div><p>You reached ${env.name}.${state.streak ? ` <b class="rr-streak">Streak ${state.streak}</b>` : ''}${state.award ? ` <b class="rr-award">+${fmt(state.award)} Discs</b>` : ''}</p><div class="answer-recap">${state.answers.map((a, i) => `<div><span>${i + 1}</span><span class="recap-title">${esc(a.label || 'Passed')}<small>${esc(a.label ? a.sub : 'No answer · 0 m')}</small></span><b style="color:${a.grade >= 0 ? GRADES[a.grade].color : '#776c8f'}" title="${a.grade >= 0 ? GRADES[a.grade].name : 'Passed'}">${a.grade >= 0 ? '◆'.repeat(a.grade + 1) : '–'}</b></div>`).join('')}</div><button class="primary" id="board-results">LEADERBOARD <span>▥</span></button><button class="secondary" id="share">SHARE YOUR FLIGHT <span>↗</span></button><small class="mock-results">NEXT RUN IN ${nextRunIn()} · MIDNIGHT UTC</small></div>`;
    $('#share').onclick = share; $('#board-results').onclick = openBoard;
  }
}

/* ---- search ------------------------------------------------------------------ */

function queueSearch() {
  clearTimeout(searchTimer);
  const text = $('#answer').value.trim();
  if (text.length < 2) { options = []; closeOptions(); return; }
  showStatus('Searching MusicBrainz…');
  searchTimer = setTimeout(() => runSearch(text), 260);
}
async function runSearch(text) {
  const q = state.questions[state.question], seq = ++searchSeq;
  try {
    const found = await net.search(text, q.kind);
    if (seq !== searchSeq || !$('#answer') || state.mode !== 'play') return;
    options = found; paintOptions(text);
  } catch (e) {
    if (e.name === 'AbortError' || seq !== searchSeq) return;
    showStatus('MusicBrainz didn’t answer. Keep typing to try again.');
  }
}
function openList() { const list = $('#suggestions'); list.hidden = false; $('#answer').setAttribute('aria-expanded', 'true'); }
function showStatus(msg) { if (!$('#suggestions')) return; openList(); $('#suggestions').innerHTML = `<div class="no-results rr-status">${esc(msg)}</div>`; }
function paintOptions(text) {
  const list = $('#suggestions'); if (!list) return; active = -1; openList();
  const q = state.questions[state.question];
  const used = new Set(state.answers.map((a) => a.id).filter(Boolean));
  if (!options.length) {
    list.innerHTML = `<div class="no-results">Nothing on MusicBrainz matches “${esc(text)}”.<small>Check the spelling, or try the artist and title together. Records missing from MusicBrainz can’t be checked yet.</small><button type="button" id="report-missing" class="rr-missing">It’s missing — tell VINALL</button></div>`;
    $('#report-missing').onmousedown = (e) => e.preventDefault();
    $('#report-missing').onclick = () => reportMissing(text);
    return;
  }
  list.innerHTML = `<div class="suggestions-head">MUSICBRAINZ <span>${options.length} MATCH${options.length === 1 ? '' : 'ES'}</span></div>` + options.map((a, i) => {
    const line = a.kind === 'album' ? [a.credit, a.year, (a.secondary || []).join(' · ')].filter(Boolean).join(' · ') : [a.disambiguation, a.type, a.begin].filter(Boolean).join(' · ');
    const hue = [...a.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
    return `<button id="option-${i}" class="suggestion${used.has(a.id) ? ' rr-used' : ''}" type="button" role="option" aria-selected="false" data-index="${i}"><span class="record-icon" style="--record-hue:${hue}"><i></i></span><span class="suggestion-copy"><strong>${esc(a.kind === 'album' ? a.title : a.name)}</strong><small>${esc(line || (a.kind === 'album' ? 'Album' : 'Artist'))}</small></span><span class="select-arrow">↵</span></button>`;
  }).join('');
  list.querySelectorAll('[data-index]').forEach((el) => { el.onmousedown = (e) => e.preventDefault(); el.onclick = () => selectOption(Number(el.dataset.index)); });
}
function selectOption(i) {
  const a = options[i]; if (!a) return;
  state.selected = a; $('#answer').value = a.kind === 'album' ? a.title : a.name; $('#clear-search').hidden = false;
  closeOptions(); $('#answer-error').textContent = ''; audio.click(); $('#launch-answer').focus();
}
function closeOptions() { if (!$('#suggestions')) return; $('#suggestions').hidden = true; $('#answer').setAttribute('aria-expanded', 'false'); $('#answer').removeAttribute('aria-activedescendant'); active = -1; }
function handleKeys(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeOptions(); return; }
  if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
    e.preventDefault(); if (!options.length) return; openList();
    if (!$('#suggestions').querySelector('[role=option]')) paintOptions($('#answer').value);
    active = active < 0 ? (e.key === 'ArrowDown' ? 0 : options.length - 1) : (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    $('#suggestions').querySelectorAll('[role=option]').forEach((el, i) => { el.classList.toggle('highlight', i === active); el.setAttribute('aria-selected', i === active); });
    $('#answer').setAttribute('aria-activedescendant', `option-${active}`); $(`#option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter' && active >= 0 && !$('#suggestions').hidden) { e.preventDefault(); selectOption(active); }
}
async function reportMissing(text) {
  try { const r = await net.missing(state.day, state.question, text); notice(r.ok ? 'Thanks. Logged as missing from the catalogue. Try another answer.' : 'You’ve reported plenty today. Try another answer.'); }
  catch (e) { notice(e.message); }
}

/* ---- answering ---------------------------------------------------------------- */

function startRun() {
  if (state.finished) return;
  state.mode = 'play'; state.selected = null; state.busy = false; state.demo = false;
  world.jump(state.total); world.setPaused(false); audio.pause(false); $('#pause-overlay').hidden = true;
  $('#rarity-reveal').classList.remove('show'); audio.click(); renderPanel();
  if (matchMedia('(hover: hover)').matches) $('#answer')?.focus();
}
async function submitAnswer() {
  if (state.busy) return;
  const q = state.questions[state.question], error = $('#answer-error');
  let a = state.selected;
  if (!a) {
    // Enter on typed text: take the top match only if it is plainly the one.
    const typed = $('#answer').value.trim().toLowerCase();
    a = options.find((o) => (o.kind === 'album' ? o.title : o.name).toLowerCase() === typed) || null;
  }
  closeOptions();
  if (!a) { error.textContent = $('#answer').value.trim() ? 'Pick your answer from the MusicBrainz list.' : `Type ${q.kind === 'album' ? 'an album' : 'an artist'} to search.`; if ($('#answer').value.trim()) { openList(); if (options.length) paintOptions($('#answer').value); } return; }
  const label = a.kind === 'album' ? a.title : a.name;
  const pre = evaluate(q, a);
  if (pre.ok === false) { error.textContent = `${label} ${pre.why}. Try another.`; audio.click(); return; }
  if (state.answers.some((p) => p.id === a.id)) { error.textContent = 'You’ve used that answer already. Find another.'; return; }
  state.busy = true; const btn = $('#launch-answer'); btn.disabled = true; btn.innerHTML = 'CHECKING… <span>◌</span>';
  let r;
  try { r = await net.answer(state.day, state.question, a.id); }
  catch (e) { r = { ok: false, message: e.message }; }
  state.busy = false;
  if (!r.ok) {
    if (r.reason === 'order' || r.reason === 'finished' || r.reason === 'closed') { notice(r.message); return boot(); }
    if ($('#launch-answer')) { btn.disabled = false; btn.innerHTML = 'LAUNCH <span>▶</span>'; }
    if ($('#answer-error')) error.textContent = r.message || 'That didn’t go through. Try again.';
    return;
  }
  land({ id: a.id, label: r.label || label, sub: r.sub || '', grade: r.grade, gain: r.gain, pct: r.pct, sample: r.sample }, r);
}
async function passQuestion() {
  if (state.busy) return;
  const b = $('#pass');
  // Two taps, not a native dialog: a pass cannot be undone.
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Tap again to pass · scores 0 m'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = 'Stuck? Pass this one for 0 m'; } }, 3500); return; }
  state.busy = true;
  let r; try { r = await net.pass(state.day, state.question); } catch (e) { r = { ok: false, message: e.message }; }
  state.busy = false;
  if (!r.ok) { notice(r.message || 'That didn’t go through.'); if (['order', 'finished', 'closed'].includes(r.reason)) boot(); return; }
  state.answers.push({ label: '', sub: '', grade: -1, gain: 0 });
  advance(r);
}
function land(answer, r) {
  if (Math.abs(world.altitude - state.total) > 1) world.jump(state.total);
  state.answers.push(answer); state.total = r.total; state.demo = false;
  ignite(answer, () => { state.busy = false; advance(r); });
}
function advance(r) {
  state.question = state.answers.length; state.selected = null; options = [];
  if (r.finished) {
    state.finished = true; state.mode = 'results'; state.award = r.award || 0; state.streak = r.streak || state.streak;
    state.best = Math.max(state.best || 0, state.total); paintStreak();
    if (state.award) net.walletSync();
  } else { state.mode = 'play'; noteHost(); }
  renderPanel();
}
function rarityLine(a) {
  if (a.pct == null) return '';
  return a.sample >= 30 ? `Picked by ${a.pct}% of ${fmt(a.sample)} players today` : `Early estimate · ${a.sample ? fmt(a.sample) + ' other player' + (a.sample === 1 ? '' : 's') + ' so far' : 'you’re among the first today'}`;
}
function ignite(answer, done) {
  const grade = answer.grade, g = GRADES[grade];
  state.busy = true; state.lastGrade = grade; state.lastFrom = world.altitude; state.mode = 'flight'; renderPanel(); audio.launch(grade);
  const reveal = $('#rarity-reveal'); reveal.className = `rarity-reveal grade-${grade}`; reveal.style.setProperty('--rarity', g.color);
  reveal.innerHTML = `<div class="reveal-sparkles">${'✦ '.repeat(Math.min(5, grade + 1))}</div><strong>${grade === 0 ? 'NICE ANSWER!' : g.name + ' ANSWER!'}</strong><span class="reveal-grade">${g.name}</span><div class="reveal-gain">+${fmt(answer.gain)} <small>m</small></div><p>${esc(rarityLine(answer))}</p>`;
  void reveal.offsetWidth; reveal.classList.add('show'); world.launch(answer.gain, g.power, done);
}
async function share() {
  const text = `RocketRun · ${dayLabel(state.day)}\n${state.answers.map((a) => (a.grade >= 0 ? '◆'.repeat(a.grade + 1) : '–')).join(' / ')}\n${fmt(state.total)} m — ${environmentAt(state.total).name}${state.streak > 1 ? ` · streak ${state.streak}` : ''}`;
  try {
    if (net.host && net.host.handOff) { net.host.handOff($('#share'), { text: text + '\n' + ((net.host.Native && net.host.Native.site) || location.origin), title: 'RocketRun', copied: 'Copied ✓' }); return; }
    await navigator.clipboard.writeText(text); notice('Flight copied. Share your good taste.');
  } catch (e) { notice(text); }
}
function openBoard() { audio.click(); if (!net.leaderboard()) notice('Leaderboards open from VINALL’s Arcade.'); }

/* ---- flight lab (?lab=1 only) ------------------------------------------------- */

function toggleDemo() { const dev = $('#dev'); if (!dev) return; dev.hidden = !dev.hidden; $('#demo-toggle').classList.toggle('active', !dev.hidden); if (!dev.hidden) renderDev(); }
function renderDev() {
  $('#dev').innerHTML = `<div class="dev-top"><h2>FLIGHT LAB</h2><button id="close-dev" class="pixel-icon" aria-label="Close flight lab">×</button></div><p>Developer controls · no score changes</p><label>TRIGGER A RARITY</label><div class="dev-rarities">${GRADES.map((g, i) => `<button data-grade="${i}" style="--rarity:${g.color}">${g.name}</button>`).join('')}</div><label for="dev-environment">JUMP TO ENVIRONMENT</label><select id="dev-environment">${ENVIRONMENTS.map((e) => `<option value="${e.altitude}" ${e.name === envName ? 'selected' : ''}>${e.name}</option>`).join('')}</select><div class="dev-row"><button id="replay">↻ Replay launch</button><button id="test-boost">▲ Test boost</button></div><label class="check-label"><input id="quality" type="checkbox" ${world.low ? 'checked' : ''}/> Fewer particles</label><label class="check-label"><input id="reduced" type="checkbox" ${world.reduced ? 'checked' : ''}/> Reduced motion</label><label class="check-label"><input id="cinema" type="checkbox" ${document.body.classList.contains('cinema') ? 'checked' : ''}/> Hide HUD / cinematic view</label><span id="lab-fps">CANVAS 2D</span>`;
  $('#close-dev').onclick = toggleDemo; document.querySelectorAll('[data-grade]').forEach((b) => (b.onclick = () => demoLaunch(Number(b.dataset.grade))));
  $('#dev-environment').onchange = (e) => { if (state.busy) return; world.jump(Number(e.target.value)); };
  $('#replay').onclick = () => { if (state.busy) return; world.jump(state.lastFrom); demoLaunch(state.lastGrade); }; $('#test-boost').onclick = () => demoLaunch(3);
  $('#quality').onchange = (e) => world.setQuality(e.target.checked); $('#reduced').onchange = (e) => (world.reduced = e.target.checked); $('#cinema').onchange = (e) => document.body.classList.toggle('cinema', e.target.checked);
}
function demoLaunch(grade) {
  if (state.busy) return notice('Let this launch finish first.');
  const prior = state.mode; state.demo = true;
  ignite({ grade, gain: GRADES[grade].gain, pct: null }, () => { state.busy = false; state.demo = false; world.jump(state.total); state.mode = prior === 'flight' ? 'play' : prior; renderPanel(); });
}

/* ---- chrome -------------------------------------------------------------------- */

function pauseGame(force) { const paused = typeof force === 'boolean' ? force : !world.paused; world.setPaused(paused); audio.pause(paused); $('#pause-overlay').hidden = !paused; $('#pause').setAttribute('aria-label', paused ? 'Resume game' : 'Pause game'); if (paused) $('#resume').focus(); }
$('#help').onclick = $('#mobile-help').onclick = () => { $('#help-dialog').showModal(); if (state.busy) { world.setPaused(true); audio.pause(true); } };
function resumeAfterHelp() { if ($('#pause-overlay').hidden) { world.setPaused(false); audio.pause(false); } }
function closeHelp() { $('#help-dialog').close(); resumeAfterHelp(); }
$('#got-it').onclick = closeHelp; $('.dialog-close').onclick = closeHelp; $('#help-dialog').addEventListener('close', resumeAfterHelp); $('#help-dialog').addEventListener('click', (e) => { if (e.target === $('#help-dialog')) closeHelp(); });
$('#sound').onclick = () => { const on = audio.toggle(); $('#sound').classList.toggle('sound-on', on); $('#sound').setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on'); $('#sound').setAttribute('aria-pressed', on); };
$('#pause').onclick = () => pauseGame(); $('#resume').onclick = () => pauseGame(false);
$('#board').onclick = openBoard;
// Leaving never loses anything: every answer is already saved on the server.
$('#exit').onclick = $('#exit-side').onclick = $('#quit').onclick = () => { audio.pause(true); net.exit(); };
if ($('#demo-toggle')) $('#demo-toggle').onclick = toggleDemo;
document.addEventListener('keydown', (e) => {
  if ($('#help-dialog').open) return;
  if (LAB && e.key.toLowerCase() === 'd' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) toggleDemo();
  if (e.key === 'Escape' && e.target.id !== 'answer') { e.preventDefault(); pauseGame(); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#answer-form')) closeOptions(); });
// The host stops the world and the sound when the sheet closes.
window.addEventListener('pagehide', () => { try { world.destroy(); audio.destroy(); } catch (e) {} });
window.RocketRun = { pause: () => pauseGame(true), state: () => state };
boot();
