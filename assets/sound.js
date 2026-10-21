/* ================================================================
   SFX — VINALL's sound. Synthesised, not sampled: no files to load, no
   licences, nothing to cache, and every sound can be pitched to what caused
   it (a 9 rings higher than a 4).

   ONE IDENTITY. Everything is built from the same two voices — a soft bell
   (sine plus a quiet inharmonic partial) and a felt "tick" (a few ms of
   filtered noise) — tuned to one scale (E major pentatonic), through one
   small room. So a rating, a level-up and a right answer sound like the same
   instrument doing different things, not three sample packs.

   IT CANNOT STACK. Each sound has a cooldown, the engine refuses new voices
   past a ceiling (low-priority sounds first), and a celebration ducks the
   small sounds under it. buzz() calls through here, so the ninety-odd places
   that already give haptic feedback sound without each being wired.

   IT BEHAVES. Off in Settings means off (vinall_sfx = 'off'). Nothing plays
   in a hidden tab. While a music preview is playing every effect drops to
   about a third, so a rating never talks over the record. The context is
   only created inside a real gesture, which is what iOS requires.
   ================================================================ */
(function () {
  'use strict';
  var KEY = 'vinall_sfx';
  var ctx = null, master = null, room = null, voices = 0, last = {}, duckUntil = 0;
  var MAX_VOICES = 14;

  function enabled() { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } }
  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
    if (on) { unlock(); setTimeout(function () { play('success'); }, 60); }
  }

  /* ---- music awareness: every <audio>, in the DOM or not ---------------- */
  var media = new Set();
  try {
    var orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      var m = this;
      if (!m._sfxHooked) {
        m._sfxHooked = true;
        ['pause', 'ended', 'emptied'].forEach(function (ev) { m.addEventListener(ev, function () { media.delete(m); }); });
        m.addEventListener('playing', function () { media.add(m); });
      }
      media.add(m);
      return orig.apply(this, arguments);
    };
  } catch (e) {}
  function musicOn() {
    var on = false;
    media.forEach(function (m) { if (!m.paused && !m.muted && m.volume > 0.05) on = true; else if (m.paused) media.delete(m); });
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
    master = ctx.createGain(); master.gain.value = 0.55;
    master.connect(comp); comp.connect(ctx.destination);
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
  var _noise = null;
  function noise() {
    if (_noise) return _noise;
    var len = ctx.sampleRate, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return (_noise = b);
  }
  // The felt tick: a few ms of band-passed noise. What a detent sounds like.
  function tick(t, freq, gain, dur) {
    voice(0.05);
    var src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), o = out(gain, 0.05);
    src.buffer = noise(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 2.2;
    dur = dur || 0.018;
    g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(o); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.01);
  }
  function whoosh(t, from, to, dur, gain) {
    voice(dur);
    var src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), o = out(gain, 0.4);
    src.buffer = noise(); src.loop = true;
    bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(o); src.start(t); src.stop(t + dur + 0.02);
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
     carries what the sound is about: v (0..1, a score), n (a count). */
  var S = {
    tap:      [45, 0, function (t) { tick(t, 2600, 0.5, 0.014); }],
    tick:     [32, 0, function (t, o) { tick(t, 1500 + 2200 * (o.v || 0), 0.42, 0.012); }],
    release:  [90, 1, function (t, o) { pluck(t, note(Math.round((o.v || 0) * 7) + 2), 0.22, 0.32); }],
    rate:     [160, 2, function (t, o) {
      var v = o.v || 0, d = Math.round(v * 6);
      bell(t, note(d), 0.9, 0.34, 0.5);
      bell(t + 0.07, note(d + (v >= 0.8 ? 4 : v >= 0.5 ? 2 : 1)), 1.1, 0.26, 0.7, v);
    }],
    success:  [140, 2, function (t) { bell(t, note(3), 0.6, 0.26); bell(t + 0.075, note(5), 0.9, 0.24, 0.7); }],
    correct:  [140, 2, function (t) { bell(t, note(5), 0.5, 0.28); bell(t + 0.06, note(7), 0.6, 0.24); bell(t + 0.12, note(10), 1.1, 0.22, 0.8, 1.4); }],
    fail:     [200, 2, function (t) { pluck(t, note(2) / 2, 0.24, 0.3); pluck(t + 0.11, note(0) / 2, 0.38, 0.28); }],
    discs:    [260, 2, function (t) {
      for (var i = 0; i < 4; i++) bell(t + i * 0.042, note(8 + i * 2), 0.45 - i * 0.05, 0.13, 0.8, 1.6);
      tick(t, 6200, 0.2, 0.02);
    }],
    unlock:   [600, 3, function (t) {
      whoosh(t, 500, 3200, 0.38, 0.12);
      [0, 2, 4, 7].forEach(function (d, i) { bell(t + 0.16 + i * 0.07, note(5 + d), 1.4, 0.2, 0.9, 1.2); });
    }],
    celebrate:[700, 3, function (t) {
      thump(t, 0.35);
      [0, 2, 4, 5, 7].forEach(function (d, i) { bell(t + 0.05 + i * 0.06, note(5 + d), 1.3, 0.18, 0.9, 1.3); });
    }],
    levelTick:[80, 3, function (t, o) { bell(t, note(4 + Math.min(o.n || 0, 6)), 0.4, 0.2, 0.5); }],
    levelUp:  [900, 4, function (t, o) {
      var b = 4 + Math.min(o.n || 0, 6);
      pad(t, [note(0) / 2, note(3) / 2, note(5) / 2], 2.2, 0.16);
      thump(t, 0.3);
      whoosh(t, 300, 4200, 0.6, 0.1);
      [0, 2, 4, 7, 9].forEach(function (d, i) { bell(t + 0.12 + i * 0.075, note(b + d), 1.6, 0.17, 0.95, 1.4); });
    }],
    whoosh:   [140, 0, function (t) { whoosh(t, 900, 2600, 0.2, 0.07); }],
    open:     [300, 1, function (t) { thump(t, 0.22); whoosh(t, 400, 2200, 0.32, 0.09); }],
    round:    [200, 1, function (t) { bell(t, note(7), 0.35, 0.16, 0.4); }],
    discover: [800, 1, function (t) { bell(t, note(5), 0.7, 0.14, 0.7); bell(t + 0.11, note(8), 0.9, 0.12, 0.8); }]
  };

  function play(name, o) {
    var s = S[name];
    if (!s || !enabled() || document.hidden) return;
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
      master.gain.setTargetAtTime(musicOn() ? 0.2 : 0.55, ctx.currentTime, 0.02);
      s[2](ctx.currentTime + 0.005, o || {});
    } catch (e) {}
  }

  // buzz() kinds → sounds. Kept here so the mapping is one table.
  var FROM_BUZZ = { tap: 'tap', good: 'success', bad: 'fail', big: 'celebrate' };
  function wireSetting() {
    var cb = document.getElementById('set-sfx-on');
    if (cb) {
      cb.checked = enabled();
      cb.addEventListener('change', function () { setEnabled(cb.checked); });
    }
    /* Entering a game is a moment: one low thump and a lift as the sheet
       arrives. Watched on the sheets' own class, so no game has to know. */
    var GAMES = /^(game|drop-modal|blitz-modal|hl-modal|recall-modal|ew-modal|war-modal|tourney-modal|charades)$/;
    try {
      var mo = new MutationObserver(function (list) {
        list.forEach(function (m) {
          var t = m.target, open = t.classList.contains('open');
          if (open && !t._sfxOpen) play('open');
          t._sfxOpen = open;
        });
      });
      Array.prototype.forEach.call(document.querySelectorAll('[id]'), function (n) {
        if (GAMES.test(n.id)) { n._sfxOpen = n.classList.contains('open'); mo.observe(n, { attributes: true, attributeFilter: ['class'] }); }
      });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireSetting); else wireSetting();

  window.Sfx = {
    play: play, enabled: enabled, setEnabled: setEnabled, unlock: unlock,
    fromBuzz: function (kind) { play(FROM_BUZZ[kind] || 'tap'); }
  };
})();
