/* ================================================================
   SFX — VINALL's sound, and the audio session it plays in.

   PHASE 1 (2026-10-27): FEW SOUNDS, AND NONE ON ORDINARY TAPS. Sound used to
   ride every buzz(), so a tab change, a heart and a dialog all made a noise.
   buzz() is haptic only now (index.html), and a sound plays only where a caller
   asks for one by name: a saved rating, a game answer, a Disc claim, a real
   win, a level-up. The voices below are still synthesised placeholders; Phase 2
   replaces them with recorded foley and keeps this vocabulary.

   IT BEHAVES. Off in Settings means off (vinall_sfx = 'off'). Nothing plays in
   a hidden tab. On the web, a playing preview turns effects down to a third.
   On iPhone (the app, and Safari) effects play only while the audio session
   is AMBIENT — which follows the silent switch — and never while music holds
   the session (see AudioMode below), so the ringer switch silences them.
   ================================================================ */
(function () {
  'use strict';
  var KEY = 'vinall_sfx';
  var ctx = null, master = null, room = null, voices = 0, last = {}, duckUntil = 0;
  var MAX_VOICES = 14;
  // The bus level, and the level under a playing preview.
  var LEVEL = 0.17, LEVEL_MUSIC = 0.06;

  function enabled() { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } }
  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
    if (on) { unlock(); setTimeout(function () { play('rate', { v: 0.8 }); }, 60); }
  }

  /* ---- music awareness: every <audio>, in the DOM or not ---------------- */
  var media = new Set();
  // `src` first: currentSrc is updated asynchronously, so straight after
  // `a.src = url; a.play()` it still names the silent unlock clip.
  function prime(m) { var s = m.src || m.currentSrc || ''; return s.indexOf('data:audio') === 0; }
  try {
    var orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      var m = this;
      if (!m._sfxHooked) {
        m._sfxHooked = true;
        ['pause', 'ended', 'emptied'].forEach(function (ev) { m.addEventListener(ev, function () { media.delete(m); AudioMode.settle(); }); });
        m.addEventListener('playing', function () { media.add(m); if (!prime(m)) AudioMode.claim(); });
      }
      media.add(m);
      // Before play(), so the session is already playback when the first
      // sample arrives (and in the background, where ambient cannot play).
      // Not for the silent clips that unlock an element inside a gesture:
      // claiming .playback for those would stop the person's own music on
      // their first tap, for a sound nobody can hear.
      if (!prime(m)) AudioMode.claim();
      return orig.apply(this, arguments);
    };
  } catch (e) {}
  /* ---- the audio session (native only) ---------------------------------
     .playback ignores the ringer switch and is what keeps a preview playing
     on the lock screen; .ambient follows the switch and mixes with whatever
     the person was already listening to. The app starts ambient
     (AppDelegate) and holds playback only while music is playing, plus a
     grace period after it stops, so lock-screen resume and the next track
     keep working. It never drops back while the app is hidden: a paused
     track on the lock screen must still resume. `hold(key, on)` is for
     audio this hook cannot see — the YouTube player in Community Choice. */
  var AudioMode = (function () {
    var mode = 'ambient', holds = {}, t = 0, GRACE = 30000, HOLD_TTL = 2000;
    function nat() { return !!(window.Native && Native.on && Native.has && Native.has('VinallNative')); }
    /* WebKit picks its own category, and picks MediaPlayback (which ignores
       the ringer switch) whenever any <audio> element exists on the page —
       playing or not — so every interface sound bypassed the silent switch.
       Measured in the simulator's WebKit log: "setting category =
       MediaPlayback" with nothing playing. The Audio Session API is how a page
       tells WebKit otherwise: 'ambient' follows the switch and mixes with the
       person's own music, 'playback' is for ours. Safari on iPhone honours it
       too, so this fixes the website, not only the app. The native category
       is set alongside for the app's own session. */
    var AS = (typeof navigator !== 'undefined' && navigator.audioSession) || null;
    function set(m, force) {
      if (m === mode && !force) return;
      mode = m;
      try { if (AS) AS.type = (m === 'playback' ? 'playback' : 'ambient'); } catch (e) {}
      if (nat()) Native.call('VinallNative', 'audioMode', { mode: m });
    }
    // A hold is a heartbeat, not a flag: its owner refreshes it while the
    // sound plays, so one that is never released (a poll cleared from
    // somewhere else) lapses by itself instead of pinning the session.
    function held() {
      var now = Date.now();
      for (var k in holds) { if (now - holds[k] < HOLD_TTL) return true; delete holds[k]; }
      return false;
    }
    function busy() { return musicOn() || held(); }
    // Checks again until it is genuinely quiet, then waits the grace out.
    function settle() {
      clearTimeout(t);
      t = setTimeout(function again() {
        if (busy() || document.hidden) { t = setTimeout(again, GRACE); return; }
        set('ambient');
      }, GRACE);
    }
    function claim() { set('playback'); settle(); }
    function hold(key, on) { if (on) { holds[key] = Date.now(); claim(); } else { delete holds[key]; } }
    set('ambient', true);
    // Effects are held back while music owns the session wherever the
    // session can be chosen (the app, and WebKit browsers): .playback would
    // carry them past the silent switch. Elsewhere they duck under the music.
    function gated() { return (nat() || !!AS) && mode !== 'ambient'; }
    return { claim: claim, settle: settle, hold: hold, mode: function () { return mode; }, native: nat, gated: gated };
  })();
  window.AudioMode = AudioMode;

  function musicOn() {
    var on = false;
    media.forEach(function (m) { if (!m.paused && !m.muted && m.volume > 0.05 && !prime(m)) on = true; else if (m.paused) media.delete(m); });
    return on;
  }

  /* ---- the engine ------------------------------------------------------ */
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(function () {}); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return; }
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    /* QUIET BY DESIGN (2026-10-24). The effects were reported as loud enough
       to dominate, so the whole bus sits about 10 dB lower than it did and a
       gentle low-pass takes the glassy top off the bells and ticks. Every
       sound keeps its place relative to the others — the vocabulary below is
       untouched — and nothing here reaches the music, which plays through
       <audio>, not this context. */
    master = ctx.createGain(); master.gain.value = LEVEL;
    var soft = ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 6800; soft.Q.value = 0.5;
    master.connect(soft); soft.connect(comp); comp.connect(ctx.destination);
    /* The room: a short, dark, generated impulse. Enough to make a bell bloom
       rather than click off, never enough to sound like a hall. */
    try {
      var len = Math.floor(ctx.sampleRate * 1.1), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = ir.getChannelData(ch);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      var conv = ctx.createConvolver(); conv.buffer = ir;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
      room = ctx.createGain(); room.gain.value = 0.22;
      room.connect(conv); conv.connect(lp); lp.connect(master);
    } catch (e) { room = null; }
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) {
    window.addEventListener(ev, function () { if (enabled()) unlock(); }, { capture: true, passive: true });
  });

  // E major pentatonic, two octaves up from E4. A score or a count picks a degree.
  var SCALE = [329.63, 369.99, 415.30, 493.88, 554.37];
  function note(deg) {
    var o = Math.floor(deg / SCALE.length), i = ((deg % SCALE.length) + SCALE.length) % SCALE.length;
    return SCALE[i] * Math.pow(2, o);
  }

  function out(gain, wet) {
    var g = ctx.createGain(); g.gain.value = gain;
    g.connect(master);
    if (room && wet) { var s = ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(room); }
    return g;
  }
  function voice(dur) {
    voices++;
    setTimeout(function () { voices = Math.max(0, voices - 1); }, dur * 1000 + 60);
  }

  // The bell: a sine, a soft octave and a faint inharmonic partial for shine.
  function bell(t, f, dur, gain, wet, bright) {
    voice(dur);
    var o = out(gain, wet == null ? 0.6 : wet);
    [[1, 1], [2, 0.18 * (bright || 1)], [2.76, 0.06 * (bright || 1)]].forEach(function (p) {
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = f * p[0];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(p[1], t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (p[0] > 1 ? 1.8 : 1));
      osc.connect(g); g.connect(o);
      osc.start(t); osc.stop(t + dur + 0.05);
    });
  }
  // A soft plucked tone — triangle through a closing filter.
  function pluck(t, f, dur, gain) {
    voice(dur);
    var o = out(gain, 0.35), osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(f * 6, t); lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp); lp.connect(g); g.connect(o); osc.start(t); osc.stop(t + dur + 0.05);
  }
  function thump(t, gain) {
    voice(0.3);
    var osc = ctx.createOscillator(), g = ctx.createGain(), o = out(gain, 0.1);
    osc.type = 'sine'; osc.frequency.setValueAtTime(120, t); osc.frequency.exponentialRampToValueAtTime(48, t + 0.22);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.3);
  }
  function pad(t, freqs, dur, gain) {
    voice(dur);
    var o = out(gain, 0.9);
    freqs.forEach(function (f, i) {
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = f; osc.detune.value = (i % 2 ? 5 : -5);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1 / freqs.length, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + dur + 0.05);
    });
  }

  /* ---- the vocabulary ---------------------------------------------------
     [cooldown ms, priority (higher survives the voice ceiling), render]. `o`
     carries what the sound is about: v (0..1, a score).

     SIX, each tied to a moment that matters. Taps, slider detents, sheets
     opening, prompts appearing and level ticks were removed: those are
     haptics or nothing. Every one of these is called by name; nothing plays a
     sound by side effect. */
  var S = {
    rate:     [160, 2, function (t, o) {
      var v = o.v || 0, d = Math.round(v * 6);
      bell(t, note(d), 0.9, 0.34, 0.5);
      bell(t + 0.07, note(d + (v >= 0.8 ? 4 : v >= 0.5 ? 2 : 1)), 1.1, 0.26, 0.7, v);
    }],
    correct:  [140, 2, function (t) { bell(t, note(5), 0.5, 0.28); bell(t + 0.06, note(7), 0.6, 0.24); bell(t + 0.12, note(10), 1.1, 0.22, 0.8, 1.4); }],
    fail:     [200, 2, function (t) { pluck(t, note(2) / 2, 0.24, 0.3); pluck(t + 0.11, note(0) / 2, 0.38, 0.28); }],
    discs:    [260, 2, function (t) {
      for (var i = 0; i < 4; i++) bell(t + i * 0.042, note(8 + i * 2), 0.45 - i * 0.05, 0.13, 0.8, 1.6);
    }],
    celebrate:[700, 3, function (t) {
      thump(t, 0.35);
      [0, 2, 4, 5, 7].forEach(function (d, i) { bell(t + 0.05 + i * 0.06, note(5 + d), 1.3, 0.18, 0.9, 1.3); });
    }],
    levelUp:  [900, 4, function (t, o) {
      var b = 4 + Math.min(o.n || 0, 6);
      pad(t, [note(0) / 2, note(3) / 2, note(5) / 2], 2.2, 0.16);
      thump(t, 0.3);
      [0, 2, 4, 7, 9].forEach(function (d, i) { bell(t + 0.12 + i * 0.075, note(b + d), 1.6, 0.17, 0.95, 1.4); });
    }]
  };

  function play(name, o) {
    var s = S[name];
    if (!s || !enabled() || document.hidden) return;
    // Native: only while the session is ambient, which the ringer switch
    // silences. While music holds the session (.playback ignores the switch)
    // an effect would sound with the phone on silent, so it does not play.
    if (AudioMode.gated()) return;
    if (!ctx) unlock();
    if (!ctx || ctx.state !== 'running') { if (ctx) ctx.resume().catch(function () {}); return; }
    var now = performance.now();
    if (last[name] && now - last[name] < s[0]) return;
    // Small sounds stand aside for a celebration rather than talking over it.
    if (s[1] < 3 && now < duckUntil) return;
    if (voices >= MAX_VOICES && s[1] < 3) return;
    last[name] = now;
    if (s[1] >= 3) duckUntil = now + 450;
    try {
      // Under a playing preview, everything is a third as loud.
      master.gain.setTargetAtTime(musicOn() ? LEVEL_MUSIC : LEVEL, ctx.currentTime, 0.02);
      s[2](ctx.currentTime + 0.005, o || {});
    } catch (e) {}
  }

  function wireSetting() {
    var cb = document.getElementById('set-sfx-on');
    if (cb) {
      cb.checked = enabled();
      cb.addEventListener('change', function () { setEnabled(cb.checked); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireSetting); else wireSetting();

  window.Sfx = {
    play: play, enabled: enabled, setEnabled: setEnabled, unlock: unlock,
    // Kept so a stale caller is a no-op rather than a TypeError. buzz() no
    // longer sounds; a sound is asked for by name.
    fromBuzz: function () {}
  };
})();
