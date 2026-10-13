/* ================================================================
   PLAY — the small moving parts the minigames share.

   roll()     an odometer: each digit is a strip of 0-9 that slides to its
              place. Strips loop forward, so 9 → 0 never jumps backwards.
   flipYear() a split-flap calendar: every digit flips forward, card by
              card, from your guess to the answer, slowing as it lands.
   count()    a number that counts up to where it ends.

   All three are display only — the value they settle on is the one they
   were given — and all three jump straight to it under reduced motion.
   ================================================================ */
(function () {
  'use strict';
  function reduced() { return !!(window.motionReduced && motionReduced()); }

  function roll(el, to, fmt) {
    if (!el) return;
    var txt = fmt ? fmt(to) : String(to);
    if (reduced() || el._rollTxt == null) { el._rollTxt = txt; el.textContent = txt; el.classList.add('pl-roll-ready'); return; }
    if (txt === el._rollTxt) return;
    var prev = el._rollTxt, up = Number(String(to).replace(/[^\d.-]/g, '')) >= Number(prev.replace(/[^\d.-]/g, ''));
    el._rollTxt = txt;
    el.classList.add('pl-roll');
    el.setAttribute('aria-label', txt);
    // Align from the right so units roll against units.
    var pad = Math.max(0, prev.length - txt.length);
    var old = prev.slice(pad);
    el.innerHTML = txt.split('').map(function (ch, i) {
      if (!/\d/.test(ch)) return '<span class="pl-sep" aria-hidden="true">' + ch + '</span>';
      var from = /\d/.test(old.charAt(i)) ? +old.charAt(i) : (up ? 0 : 9);
      // Two laps of 0-9 so a forward roll from 8 to 1 can travel 8,9,0,1.
      return '<span class="pl-col" aria-hidden="true"><span class="pl-strip" data-from="' + from + '" data-to="' + ch + '">' +
        '0123456789012345678'.split('').map(function (d) { return '<b>' + d + '</b>'; }).join('') + '</span></span>';
    }).join('');
    var strips = el.querySelectorAll('.pl-strip');
    strips.forEach(function (s, i) {
      var f = +s.dataset.from, t = +s.dataset.to;
      var end = up ? (t >= f ? t : t + 10) : t;     // forward roll wraps; a fall goes straight
      var start = up ? f : (f >= t ? f : f + 10);
      s.style.transform = 'translateY(' + (-start) + 'em)';
      void s.offsetWidth;
      s.style.transitionDelay = ((strips.length - 1 - i) * 35) + 'ms';
      s.style.transform = 'translateY(' + (-end) + 'em)';
    });
  }

  function flipYear(el, from, to) {
    if (!el) return;
    var t = String(to), f = String(from || to);
    if (!/^\d{4}$/.test(t)) { el.textContent = t; return; }
    if (!/^\d{4}$/.test(f)) f = t;
    el.classList.add('pl-flip');
    el.setAttribute('aria-label', t);
    el.innerHTML = f.split('').map(function (d) { return '<span class="pl-card" aria-hidden="true"><b>' + d + '</b></span>'; }).join('');
    if (reduced()) { el.querySelectorAll('.pl-card b').forEach(function (b, i) { b.textContent = t.charAt(i); }); return; }
    var cards = el.querySelectorAll('.pl-card');
    cards.forEach(function (card, i) {
      var cur = +f.charAt(i), target = +t.charAt(i);
      // Always forward, like a calendar: 9 goes on to 0, never back down.
      var steps = (target - cur + 10) % 10;
      // The last two digits take a full extra lap, so even a near guess
      // gets the drum turning before it lands.
      if (i >= 2) steps += 10;
      if (!steps) return;
      var b = card.querySelector('b'), n = 0;
      (function flap() {
        n++;
        var left = steps - n;
        // Fast through the middle, slowing over the last four flaps.
        var d = left < 4 ? 120 + (4 - left) * 55 : 62;
        card.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-82deg)', offset: .5 }, { transform: 'rotateX(0deg)' }],
          { duration: d, easing: 'linear' });
        setTimeout(function () { cur = (cur + 1) % 10; b.textContent = cur; }, d / 2);
        if (n < steps) setTimeout(flap, d);
        else setTimeout(function () { card.classList.add('pl-land'); }, d);
      })();
    });
  }

  function count(el, from, to, ms, fmt) {
    if (!el) return;
    fmt = fmt || function (v) { return Math.round(v).toLocaleString('en-GB'); };
    if (reduced() || typeof to !== 'number' || !isFinite(to)) { el.textContent = fmt(to); return; }
    var t0 = performance.now(), tok = (el._countTok = (el._countTok || 0) + 1);
    (function step(now) {
      if (el._countTok !== tok) return;
      var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 4);
      el.textContent = fmt(k < 1 ? from + (to - from) * e : to);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  window.Play = { roll: roll, flipYear: flipYear, count: count };
})();
