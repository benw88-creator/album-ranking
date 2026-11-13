// RocketRun — the daily music run, inside VINALL's Arcade.
// Renderer, sprites, sound and layout are the prototype's (world.js, pixels.js,
// audio.js, style.css). What changed: the prompts, the catalogue, the rarity
// and the score now come from /api/rocketrun and MusicBrainz, not a local list.
import { GRADES, evaluate, dayNumber, dayLabel, rankAnswers, labelOf, squash, TIME_LIMIT_MS } from '../../assets/rocketrun-rules.js?v=2';
import { ENVIRONMENTS, environmentAt } from './data.js';
import { RocketWorld } from './world.js';
import { FlightAudio } from './audio.js';
import { drawLogo, rocketSprite } from './pixels.js';
import * as net from './net.js?v=2';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.floor(n).toLocaleString('en-GB');
const LAB = new URLSearchParams(location.search).has('lab');
const audio = new FlightAudio();
let state = { mode: 'boot', day: null, questions: [], question: 0, answers: [], selected: null, total: 0, busy: false, demo: false, lastGrade: 2, lastFrom: 0, finished: false, streak: 0, best: 0, award: 0, signedIn: false, error: '' };
let active = -1, options = [], envName = 'Neon City', lastPaint = 0, searchTimer = 0, searchSeq = 0, searching = false, pendingEnter = false, fix = null;
// The clock. The server owns it (rr_open_q); this only draws it and asks for
// the pass when it reaches zero. deadline is a performance.now() time.
let clock = { q: -1, deadline: 0, tick: 0 };
const rocketURI = rocketSprite().toDataURL();
const gradeOf = (g) => GRADES[Math.max(0, g)];
document.documentElement.classList.toggle('embedded', !!net.host);

$('#app').innerHTML = `
<aside class="cabinet cabinet-left"><button class="vinall-word" id="exit-side" type="button" aria-label="Back to the Arcade"><span class="vinyl"></span> VINALL</button><div class="cabinet-copy"><span class="small-kicker">THE DAILY MUSIC RUN</span><h1>Deep cuts.<br>Great heights.</h1><p>Five prompts a day.<br>Any record ever made.</p><div class="how-it-works"><span>01 <b>Name an album or artist</b></span><span>02 <b>30 seconds a prompt</b></span><span>03 <b>Rarer answers fly further</b></span></div></div><button id="help" class="quiet-button">How to play <span>?</span></button><small class="standalone-note">Answers are checked against MusicBrainz,<br>the open music database.</small></aside>
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
  <section id="pause-overlay" class="pause-overlay" hidden aria-label="Paused game"><div class="pause-card pixel-frame"><span class="small-kicker">PAUSED</span><h2>FLIGHT PAUSED</h2><p class="rr-pause-note" id="pause-note" hidden>The clock is still running.</p><button id="resume" class="primary">RESUME <span>▶</span></button><button id="quit" class="secondary">BACK TO THE ARCADE</button></div></section>
</main>
<aside class="cabinet cabinet-right"><div class="today-date"><span id="side-date"></span><span>FLIGHT PLAN / 05 PROMPTS</span></div><div class="destination-list">${ENVIRONMENTS.map((e, i) => `<div class="destination ${i === 0 ? 'current' : ''}" data-env="${e.name}"><i></i><span>${e.name}<small>${fmt(e.altitude)} m</small></span></div>`).join('')}</div><div class="fuel-guide"><span class="small-kicker">DISTANCE BY RARITY</span>${GRADES.map((g, i) => `<div style="--grade:${g.color}"><span>${'◆'.repeat(Math.min(3, i + 1))}</span><strong>${g.name}</strong><b>+${fmt(g.gain)}</b></div>`).join('')}</div><p class="keyboard-tip">Best with sound on.<br><kbd>Esc</kbd> pause</p></aside>
<dialog id="help-dialog" class="pixel-frame"><button class="dialog-close pixel-icon" aria-label="Close instructions">×</button><span class="small-kicker">HOW TO PLAY</span><h2>Rare answers<br>fly further.</h2><p>Five prompts a day, the same five for everyone. Answer each one with an album or artist that fits. Anything on MusicBrainz counts, however obscure.</p><p>You get 30 seconds a prompt. The fewer players who give your answer, the further you fly. Early in the day there aren’t many answers yet, so rarity is estimated from MusicBrainz.</p><div class="help-grades">${GRADES.map((g) => `<div><b style="color:${g.color}">${g.name}</b><span>+${fmt(g.gain)} m</span></div>`).join('')}</div><p class="fineprint">One run a day. No repeats. Stuck? Pass for 0 m. If a record isn’t on MusicBrainz it can’t be checked: report it and pick another. New prompts at midnight UTC.</p><button id="got-it" class="primary">GOT IT <span>▶</span></button></dialog><div class="notice" id="notice" role="status"></div>`;
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
  state.mode = 'boot'; state.error = ''; stopClock(); renderPanel();
  try {
    state.signedIn = await net.signedIn();
    const d = state.signedIn ? await net.getState() : await net.getDay();
    state.day = d.day; state.questions = d.questions;
    $('#side-date').textContent = dayLabel(d.day);
    const answers = (d.answers || []).map((a) => ({ id: a.key ? a.key.slice(3) : null, label: a.label, sub: a.sub, grade: a.grade, gain: a.gain, pct: a.pct, sample: a.sample, timeout: !!a.timeout }));
    Object.assign(state, { answers, question: answers.length, total: d.total || 0, finished: !!d.finished, streak: d.streak || 0, best: d.best || 0, award: d.awarded || 0, selected: null, busy: false, open: d.open || null });
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
  if (document.visibilityState !== 'visible' || state.day == null) return;
  if (dayNumber() !== state.day && !state.busy && ['menu', 'results'].includes(state.mode)) return boot();
  // Back from the background: the server's clock kept running, so ask it.
  if (state.mode === 'play' && !state.busy) openQuestion();
});

/* ---- the clock ------------------------------------------------------------------ */

function startClock(remaining) {
  clock.q = state.question;
  clock.deadline = performance.now() + Math.max(0, remaining);
  clearInterval(clock.tick);
  clock.tick = setInterval(paintClock, 200);
  paintClock();
}
function stopClock() { clearInterval(clock.tick); clock.tick = 0; clock.q = -1; }
function remainingMs() { return clock.q === state.question ? Math.max(0, clock.deadline - performance.now()) : TIME_LIMIT_MS; }
function paintClock() {
  const el = $('#clock'); if (!el) return;
  const ms = remainingMs(), s = Math.ceil(ms / 1000);
  // Frozen while an answer is being checked: it arrived in time, whatever happens next.
  if (!state.busy) {
    $('#clock-s').textContent = s;
    $('#clock-fill').style.transform = `scaleX(${ms / TIME_LIMIT_MS})`;
    el.classList.toggle('urgent', s <= 10);
    el.classList.toggle('critical', s <= 5);
    if (s <= 5 && s !== paintClock.last && s > 0) audio.click();
    paintClock.last = s;
  }
  if (ms <= 0 && !state.busy && state.mode === 'play' && !world.paused) timeUp();
}
// Opens the current question on the server: starts its 30 seconds the first
// time, and tells us what is left on any later call (refresh, back from the
// background, a second device).
async function openQuestion() {
  const q = state.question;
  if (clock.q !== q) startClock(state.open && state.open.q === q ? state.open.remaining_ms : TIME_LIMIT_MS);
  state.open = null;
  let r;
  try { r = await net.open(state.day, q); } catch (e) { return; }   // the local clock carries on; the server still judges
  if (state.mode !== 'play' || state.question !== q) return;
  if (r.ok) return startClock(r.remaining_ms);
  if (r.reason === 'timeout') { stopClock(); state.answers.push({ label: '', sub: '', grade: -1, gain: 0, timeout: true }); notice('Out of time on that one. 0 m.'); return advance(r); }
  if (['order', 'finished', 'closed'].includes(r.reason)) { notice(r.message); boot(); }
}
async function timeUp() {
  if (state.busy) return;
  state.busy = true; stopClock(); closeOptions();
  const q = state.question;
  const card = $('.question-card'); if (card) card.classList.add('rr-timeup');
  let r; try { r = await net.pass(state.day, q); } catch (e) { r = { ok: false, message: e.message }; }
  state.busy = false;
  if (!r.ok) { notice(r.message || 'That didn’t go through.'); return boot(); }
  state.answers.push({ label: '', sub: '', grade: -1, gain: 0, timeout: true });
  notice('Time’s up. 0 m for that one.');
  advance(r);
}

/* ---- panels ------------------------------------------------------------------ */

function nextRunIn() {
  const ms = Date.UTC(2020, 0, 1) + (dayNumber() + 1) * 86400000 - Date.now();
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
function recapLine(a) {
  if (a.label) return `${esc(a.label)}<small>${esc(a.sub)}</small>`;
  return `${a.timeout ? 'Out of time' : 'Passed'}<small>0 m</small>`;
}
function renderPanel() {
  const panel = $('#panel'); document.body.dataset.mode = state.mode === 'boot' || state.mode === 'error' ? 'menu' : state.mode;
  world.setLayout(document.body.dataset.mode); panel.className = 'flight-panel';
  if (state.mode !== 'play') { stopClock(); }
  $('#pause-note').hidden = state.mode !== 'play';
  $('#question-count').textContent = ['play', 'flight'].includes(state.mode) ? `${Math.min(state.question + 1, 5)} / 5` : (state.streak ? `STREAK ${state.streak}` : 'DAILY RUN');
  if (state.mode === 'boot') {
    panel.innerHTML = `<div class="menu-card pixel-frame rr-loading"><span class="card-tab">DAILY</span><h2>Loading…</h2><p>Getting today’s five prompts.</p></div>`;
  } else if (state.mode === 'error') {
    panel.innerHTML = `<div class="menu-card pixel-frame"><span class="card-tab">OFFLINE</span><h2>Can’t connect.</h2><p>${esc(state.error)}</p></div><button id="retry" class="primary launch-button">TRY AGAIN <span>↻</span></button>`;
    $('#retry').onclick = boot;
  } else if (state.mode === 'menu') {
    const started = state.answers.length > 0;
    panel.innerHTML = `<div class="menu-card pixel-frame"><span class="card-tab">DAILY · ${esc(dayLabel(state.day).toUpperCase())}</span><h2>Five prompts.<br>Any record.</h2><p>Name albums and artists that fit. The fewer people who pick your answer, the higher you fly.</p><span class="menu-detail">${started ? `${state.answers.length} OF 5 DONE · ${fmt(state.total)} M` : 'ONE RUN A DAY · 30 SECONDS A PROMPT'}</span></div>${
      state.signedIn
        ? `<button id="start" class="primary launch-button">${started ? 'CARRY ON' : 'START'} <span>▶</span></button>${state.best ? `<p class="start-note">Your best: ${fmt(state.best)} m</p>` : ''}`
        : `<button id="signin" class="primary launch-button">LOG IN TO PLAY <span>▶</span></button><p class="start-note">Your runs and streak save to your VINALL account.</p>`}`;
    if ($('#start')) $('#start').onclick = startRun;
    if ($('#signin')) $('#signin').onclick = () => { audio.click(); net.login(); };
  } else if (state.mode === 'play') {
    const q = state.questions[state.question];
    const album = q.kind === 'album';
    panel.innerHTML = `<div class="question-card pixel-frame"><span class="card-tab">${state.question + 1} OF 5</span><div class="rr-qhead"><span class="question-kind">${album ? 'ALBUM' : 'ARTIST'}<span class="rr-tier" aria-label="Difficulty ${q.tier} of 3">${'◆'.repeat(q.tier)}</span></span><div class="rr-clock" id="clock" role="timer" aria-label="Time left"><b id="clock-s">30</b><i class="rr-clock-bar"><i id="clock-fill"></i></i></div></div><h2>${esc(q.text)}</h2><p class="question-hint">${esc(q.hint)}</p><form id="answer-form" autocomplete="off"><div class="rr-field"><div class="search-wrap"><span class="search-icon" aria-hidden="true">⌕</span><input id="answer" role="combobox" enterkeyhint="go" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Search ${album ? 'albums' : 'artists'}" aria-autocomplete="list" aria-expanded="false" aria-controls="suggestions" placeholder="${album ? 'Search albums' : 'Search artists'}"/><button type="button" id="clear-search" aria-label="Clear answer" hidden>×</button></div><div id="suggestions" class="suggestions pixel-frame" role="listbox" hidden></div></div><div id="pick" class="rr-pick" aria-live="polite" hidden></div><div id="answer-error" class="answer-error" role="alert"></div><button class="primary" type="submit" id="launch-answer">LAUNCH <span>▶</span></button></form><button id="pass" class="browse-button">Pass (0 m)</button></div>`;
    const input = $('#answer');
    input.addEventListener('input', () => { state.selected = null; fix = null; pendingEnter = false; paintPick(); $('#answer-error').textContent = ''; $('#clear-search').hidden = !input.value; queueSearch(); });
    input.addEventListener('focus', () => { if (input.value && options.length && !state.selected) openList(); });
    input.addEventListener('keydown', handleKeys);
    $('#answer-form').onsubmit = (e) => { e.preventDefault(); onEnter(true); };
    $('#clear-search').onclick = () => { state.selected = null; fix = null; input.value = ''; $('#clear-search').hidden = true; options = []; paintPick(); closeOptions(); input.focus(); };
    $('#pass').onclick = passQuestion;
    openQuestion();
  } else if (state.mode === 'flight') {
    const a = state.demo ? null : state.answers.at(-1);
    panel.innerHTML = `<div class="answer-accepted pixel-frame"><span>✓</span><div>${esc(a ? a.label : 'Flight lab')}<small>${esc(a ? a.sub : 'Test launch')}</small></div></div>`;
  } else if (state.mode === 'results') {
    const env = environmentAt(state.total);
    panel.innerHTML = `<div class="results-card pixel-frame"><span class="card-tab">TODAY’S RUN</span><h2>Run complete</h2><div class="results-altitude">${fmt(state.total)}<small>m</small></div><p>You reached ${env.name}.${state.streak ? ` <b class="rr-streak">Streak ${state.streak}</b>` : ''}${state.award ? ` <b class="rr-award">+${fmt(state.award)} Discs</b>` : ''}</p><div class="answer-recap">${state.answers.map((a, i) => `<div><span>${i + 1}</span><span class="recap-title">${recapLine(a)}</span><b style="color:${a.grade >= 0 ? GRADES[a.grade].color : '#9a8fb0'}">${a.grade >= 0 ? GRADES[a.grade].name : '–'}</b></div>`).join('')}</div><button class="primary" id="board-results">LEADERBOARD <span>▥</span></button><button class="secondary" id="share">SHARE <span>↗</span></button><small class="mock-results">Next run in ${nextRunIn()}</small></div>`;
    $('#share').onclick = share; $('#board-results').onclick = openBoard;
  }
}

/* ---- search ------------------------------------------------------------------ */

function queueSearch() {
  clearTimeout(searchTimer);
  const text = $('#answer').value.trim();
  if (text.length < 2) { options = []; searching = false; closeOptions(); return; }
  searching = true;
  if (!options.length) showStatus('Searching…');
  searchTimer = setTimeout(() => runSearch(text), 220);
}
async function runSearch(text) {
  const q = state.questions[state.question], seq = ++searchSeq;
  try {
    const found = await net.search(text, q.kind);
    if (seq !== searchSeq || !$('#answer') || state.mode !== 'play') return;
    searching = false;
    const ranked = rankAnswers(text, found);
    options = ranked.list; fix = ranked.fix;
    const input = $('#answer');
    // A clear match is picked and shown, never submitted. Its spelling is
    // corrected only if the player has not typed since, and only when the
    // difference is case, accents or punctuation.
    if (ranked.pick && input.value.trim() === text) {
      select(ranked.pick, { auto: true, correct: squash(text) === squash(labelOf(ranked.pick)) });
    } else {
      paintOptions(text);
      if (pendingEnter) { pendingEnter = false; if (options.length) highlight(0); }
    }
  } catch (e) {
    if (e.name === 'AbortError' || seq !== searchSeq) return;
    searching = false; pendingEnter = false;
    showStatus('MusicBrainz didn’t answer. Keep typing to try again.');
  }
}
function openList() { const list = $('#suggestions'); list.hidden = false; $('#answer').setAttribute('aria-expanded', 'true'); }
function showStatus(msg) { if (!$('#suggestions')) return; openList(); $('#suggestions').innerHTML = `<div class="no-results rr-status">${esc(msg)}</div>`; }
function metaOf(a) { return a.kind === 'album' ? [a.credit, a.year, (a.secondary || []).join(' · ')].filter(Boolean).join(' · ') : [a.disambiguation, a.type, a.country, a.begin].filter(Boolean).join(' · '); }
function paintOptions(text) {
  const list = $('#suggestions'); if (!list) return; active = -1; openList();
  const used = new Set(state.answers.map((a) => a.id).filter(Boolean));
  if (!options.length) {
    list.innerHTML = `<div class="no-results">No match for “${esc(text)}”.<small>Check the spelling, or try the artist and title together.</small><button type="button" id="report-missing" class="rr-missing">It’s missing from MusicBrainz</button></div>`;
    $('#report-missing').onmousedown = (e) => e.preventDefault();
    $('#report-missing').onclick = () => reportMissing(text);
    return;
  }
  list.innerHTML = (fix ? '<div class="suggestions-head">Did you mean</div>' : '') + options.map((a, i) => {
    const hue = [...a.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
    return `<button id="option-${i}" class="suggestion${used.has(a.id) ? ' rr-used' : ''}${state.selected && state.selected.id === a.id ? ' rr-chosen' : ''}" type="button" role="option" aria-selected="false" data-index="${i}"><span class="record-icon" style="--record-hue:${hue}"><i></i></span><span class="suggestion-copy"><strong>${esc(labelOf(a))}</strong><small>${esc(metaOf(a) || (a.kind === 'album' ? 'Album' : 'Artist'))}</small></span></button>`;
  }).join('');
  list.querySelectorAll('[data-index]').forEach((el) => { el.onmousedown = (e) => e.preventDefault(); el.onclick = () => select(options[Number(el.dataset.index)]); });
}
function highlight(i) {
  active = i;
  $('#suggestions').querySelectorAll('[role=option]').forEach((el, j) => { el.classList.toggle('highlight', j === active); el.setAttribute('aria-selected', j === active); });
  $('#answer').setAttribute('aria-activedescendant', `option-${active}`); $(`#option-${active}`)?.scrollIntoView({ block: 'nearest' });
}
// Chooses an answer. Shown under the box with its artist and year, so a pick
// is never silent; Enter or LAUNCH then sends it.
function select(a, opts = {}) {
  if (!a) return;
  const input = $('#answer');
  state.selected = a; fix = null;
  if (!opts.auto || opts.correct) {
    const keepCaret = input.selectionStart === input.value.length;
    input.value = labelOf(a);
    if (keepCaret) try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
  }
  $('#clear-search').hidden = false; $('#answer-error').textContent = '';
  closeOptions(); paintPick();
  if (!opts.auto) audio.click();
  net.warm(state.day, state.question, a.id);
}
function paintPick() {
  const el = $('#pick'); if (!el) return;
  const a = state.selected;
  if (!a) { el.hidden = true; el.innerHTML = ''; return; }
  const others = options.filter((o) => o.id !== a.id).length;
  el.hidden = false;
  el.innerHTML = `<span class="rr-pick-tick">✓</span><span class="rr-pick-copy"><b>${esc(labelOf(a))}</b><small>${esc(metaOf(a) || '')}</small></span>${others ? `<button type="button" id="pick-change">Change</button>` : ''}`;
  const c = $('#pick-change');
  if (c) { c.onmousedown = (e) => e.preventDefault(); c.onclick = () => { paintOptions($('#answer').value); $('#answer').focus(); }; }
}
function closeOptions() { if (!$('#suggestions')) return; $('#suggestions').hidden = true; $('#answer').setAttribute('aria-expanded', 'false'); $('#answer').removeAttribute('aria-activedescendant'); active = -1; }
function handleKeys(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeOptions(); return; }
  if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
    e.preventDefault(); if (!options.length) return;
    if ($('#suggestions').hidden || !$('#suggestions').querySelector('[role=option]')) paintOptions($('#answer').value);
    highlight(active < 0 ? (e.key === 'ArrowDown' ? 0 : options.length - 1) : (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
  }
}
/* Enter (or LAUNCH). Only ever sends an answer that is already chosen and on
 * screen. Otherwise it chooses: the highlighted row, the "did you mean", or
 * the top row (highlighted, so a second Enter takes it). */
function onEnter(fromSubmit) {
  if (state.busy) return;
  const list = $('#suggestions'), open = list && !list.hidden;
  if (open && active >= 0) return select(options[active]);
  if (state.selected) return submitAnswer();
  const text = $('#answer').value.trim();
  if (!text) { $('#answer-error').textContent = `Type ${state.questions[state.question].kind === 'album' ? 'an album' : 'an artist'} to search.`; return; }
  if (searching) { pendingEnter = true; return; }
  if (fix) return select(fix);
  if (options.length) { if (!open) paintOptions(text); highlight(0); $('#answer-error').textContent = 'Pick one from the list.'; return; }
  if (fromSubmit) $('#answer-error').textContent = 'Nothing matches yet. Keep typing.';
}
async function reportMissing(text) {
  try { const r = await net.missing(state.day, state.question, text); notice(r.ok ? 'Thanks, noted. Try another answer.' : 'You’ve reported a lot today. Try another answer.'); }
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
  const a = state.selected;
  if (!a) return onEnter(true);
  closeOptions();
  const label = labelOf(a);
  const pre = evaluate(q, a);
  if (pre.ok === false) { error.textContent = `${label} ${pre.why}. Try another.`; audio.click(); return; }
  if (state.answers.some((p) => p.id === a.id)) { error.textContent = 'You’ve used that one already.'; return; }
  state.busy = true; const btn = $('#launch-answer'); btn.disabled = true; btn.innerHTML = 'CHECKING <span class="rr-dots"><i></i><i></i><i></i></span>';
  $('.question-card').classList.add('rr-checking');
  let r;
  try {
    r = await net.answer(state.day, state.question, a.id);
    // The server refuses an answer to a question whose clock it never started
    // (the open request was lost); it starts it with that refusal. Once.
    if (r && r.reason === 'not_open') r = await net.answer(state.day, state.question, a.id);
  } catch (e) { r = { ok: false, message: e.message }; }
  state.busy = false;
  if (!r.ok) {
    if (r.reason === 'timeout') { stopClock(); state.answers.push({ label: '', sub: '', grade: -1, gain: 0, timeout: true }); notice(r.message); return advance(r); }
    if (r.reason === 'order' || r.reason === 'finished' || r.reason === 'closed') { notice(r.message); return boot(); }
    if ($('#launch-answer')) { btn.disabled = false; btn.innerHTML = 'LAUNCH <span>▶</span>'; $('.question-card').classList.remove('rr-checking'); }
    if ($('#answer-error')) error.textContent = r.message || 'That didn’t go through. Try again.';
    paintClock();
    return;
  }
  stopClock();
  land({ id: a.id, label: r.label || label, sub: r.sub || '', grade: r.grade, gain: r.gain, pct: r.pct, sample: r.sample }, r);
}
async function passQuestion() {
  if (state.busy) return;
  const b = $('#pass');
  // Two taps, not a native dialog: a pass cannot be undone.
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Tap again to pass'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = 'Pass (0 m)'; } }, 3500); return; }
  state.busy = true; stopClock();
  let r; try { r = await net.pass(state.day, state.question); } catch (e) { r = { ok: false, message: e.message }; }
  state.busy = false;
  if (!r.ok) { notice(r.message || 'That didn’t go through.'); if (['order', 'finished', 'closed'].includes(r.reason)) boot(); else openQuestion(); return; }
  state.answers.push({ label: '', sub: '', grade: -1, gain: 0, timeout: !!r.timeout });
  advance(r);
}
function land(answer, r) {
  if (Math.abs(world.altitude - state.total) > 1) world.jump(state.total);
  state.answers.push(answer); state.total = r.total; state.demo = false;
  ignite(answer, () => { state.busy = false; advance(r); });
}
function advance(r) {
  state.question = state.answers.length; state.selected = null; options = []; fix = null; pendingEnter = false;
  if (r.total != null) state.total = r.total;
  if (r.finished) {
    state.finished = true; state.mode = 'results'; state.award = r.award || 0; state.streak = r.streak || state.streak;
    state.best = Math.max(state.best || 0, state.total); paintStreak();
    if (state.award) net.walletSync();
    try { net.host.notePlay && net.host.notePlay('rocketrun'); } catch (e) {}
  } else { state.mode = 'play'; noteHost(); }
  renderPanel();
}
function rarityLine(a) {
  if (a.pct == null) return '';
  return a.sample >= 30 ? `${a.pct}% of ${fmt(a.sample)} players picked this` : `Early estimate · ${a.sample ? fmt(a.sample) + ' other player' + (a.sample === 1 ? '' : 's') + ' so far' : 'you’re one of the first today'}`;
}
function ignite(answer, done) {
  const grade = answer.grade, g = GRADES[grade];
  state.busy = true; state.lastGrade = grade; state.lastFrom = world.altitude; state.mode = 'flight'; renderPanel(); audio.launch(grade);
  const reveal = $('#rarity-reveal'); reveal.className = `rarity-reveal grade-${grade}`; reveal.style.setProperty('--rarity', g.color);
  const line = rarityLine(answer);
  reveal.innerHTML = `<div class="reveal-sparkles">${'✦ '.repeat(Math.min(5, grade + 1))}</div><strong>${g.name}</strong><div class="reveal-gain">+${fmt(answer.gain)} <small>m</small></div>${line ? `<p>${esc(line)}</p>` : ''}`;
  void reveal.offsetWidth; reveal.classList.add('show'); world.launch(answer.gain, g.power, done);
}
async function share() {
  const text = `RocketRun · ${dayLabel(state.day)}\n${state.answers.map((a) => (a.grade >= 0 ? '◆'.repeat(a.grade + 1) : '–')).join(' / ')}\n${fmt(state.total)} m · ${environmentAt(state.total).name}${state.streak > 1 ? ` · streak ${state.streak}` : ''}`;
  try {
    if (net.host && net.host.handOff) { net.host.handOff($('#share'), { text, title: 'RocketRun', copied: 'Copied ✓' }); return; }
    await navigator.clipboard.writeText(text); notice('Copied.');
  } catch (e) { notice(text); }
}
function openBoard() { audio.click(); if (!net.leaderboard()) notice('The leaderboard opens from the Arcade.'); }

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

function pauseGame(force) { const paused = typeof force === 'boolean' ? force : !world.paused; world.setPaused(paused); if (!paused) paintClock(); audio.pause(paused); $('#pause-overlay').hidden = !paused; $('#pause').setAttribute('aria-label', paused ? 'Resume game' : 'Pause game'); if (paused) $('#resume').focus(); }
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
