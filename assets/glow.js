/* ================================================================
   GLOW SLIDER — the rating drag.

   It sits on top of a real <input type=range>, which stays in the DOM,
   focusable and labelled, and remains the source of truth: every move
   writes input.value and fires a genuine 'input' event, so whatever
   already listens (the rate sheet, Your music) works unchanged.

   What it adds is feel: the fill and a value pill follow the finger on
   transform only, the track stretches like elastic when you drag past an
   end and springs back on release, the pill squashes with speed, a tick
   of haptics on every step of ten, and a bloom when you let go.
   ================================================================ */
(function () {
  'use strict';
  function reduced() { return !!(window.motionReduced && motionReduced()); }
  function col(v, max) { return window.albumColor ? albumColor(Math.round(v / max * 100)) : '#f5c842'; }

  function enhance(input, opts) {
    if (!input || input._gs) return input && input._gs;
    opts = opts || {};
    var min = +input.min || 0, max = +input.max || 100, step = +input.step || 1;
    var wrap = document.createElement('div');
    wrap.className = 'gs' + (opts.className ? ' ' + opts.className : '');
    wrap.innerHTML = '<div class="gs-track"><div class="gs-fill"><i class="gs-sparks"></i></div><div class="gs-dots"></div></div>' +
      '<div class="gs-thumb"><b></b></div>';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.classList.add('gs-native');
    input.tabIndex = 0;
    var track = wrap.querySelector('.gs-track'), fill = wrap.querySelector('.gs-fill'),
        thumb = wrap.querySelector('.gs-thumb'), label = thumb.querySelector('b'), dots = wrap.querySelector('.gs-dots');
    dots.innerHTML = new Array(9).join('<i></i>');

    var IN = 4, W = 0, TW = 0, drag = null, raf = 0, lastTick = null, want = null;
    function measure() { W = track.clientWidth; TW = thumb.offsetWidth; }
    function frac(v) { return (v - min) / (max - min); }
    function paint(v, over, squash) {
      if (!W) measure();
      var f = frac(v), x = IN + f * (W - TW - 2 * IN);
      fill.style.clipPath = 'inset(0 ' + Math.max(0, W - x - TW) + 'px 0 0 round 999px)';
      thumb.style.transform = 'translateX(' + x + 'px) scale(' + (1 + (squash || 0)) + ',' + (1 - (squash || 0) * .55) + ')';
      label.textContent = opts.format ? opts.format(v) : v;
      var c = col(v - min, max - min);
      wrap.style.setProperty('--gs-c', c);
      // Past an end the whole track stretches toward the finger, then gives.
      track.style.transform = over ? 'scaleX(' + (1 + Math.abs(over) / W) + ')' : '';
      track.style.transformOrigin = over > 0 ? 'left center' : 'right center';
      thumb.style.marginLeft = over > 0 ? over + 'px' : over < 0 ? over + 'px' : '';
      wrap.classList.toggle('gs-max', v >= max);
    }
    function sync() { measure(); paint(+input.value); }
    function setVal(v, fire) {
      v = Math.max(min, Math.min(max, Math.round(v / step) * step));
      if (+input.value === v) return v;
      input.value = v;
      if (fire !== false) input.dispatchEvent(new Event('input', { bubbles: true }));
      // A tick every tenth of the range: felt, not buzzing.
      var bucket = Math.floor(frac(v) * 10);
      if (lastTick !== null && bucket !== lastTick && window.buzz) buzz('tap');
      lastTick = bucket;
      return v;
    }
    function rubber(d) { return d * 0.42 / (1 + Math.abs(d) / 140); }

    wrap.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      measure();
      var r = track.getBoundingClientRect();
      drag = { id: e.pointerId, r: r, from: +input.value, lx: e.clientX, lt: e.timeStamp, v: 0 };
      wrap.setPointerCapture(e.pointerId);
      wrap.classList.add('gs-drag');
      lastTick = Math.floor(frac(+input.value) * 10);
      move(e);
      input.focus({ preventScroll: true });
      e.preventDefault();
    });
    function move(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var x = e.clientX - drag.r.left - IN - TW / 2, span = drag.r.width - TW - 2 * IN;
      var over = x < 0 ? rubber(x) : x > span ? rubber(x - span) : 0;
      var dt = Math.max(1, e.timeStamp - drag.lt);
      drag.v = drag.v * 0.6 + ((e.clientX - drag.lx) / dt) * 0.4;
      drag.lx = e.clientX; drag.lt = e.timeStamp;
      var v = setVal(min + Math.max(0, Math.min(1, x / span)) * (max - min));
      want = [v, reduced() ? 0 : over, reduced() ? 0 : Math.min(0.28, Math.abs(drag.v) * 0.09)];
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; if (want) paint.apply(null, want); });
    }
    wrap.addEventListener('pointermove', move);
    function end(e, cancelled) {
      if (!drag || e.pointerId !== drag.id) return;
      if (cancelled) setVal(drag.from);
      drag = null; want = null;
      wrap.classList.remove('gs-drag');
      // Spring home: the transition is on the class, so the release eases back.
      wrap.classList.add('gs-release');
      paint(+input.value);
      if (!cancelled && !reduced()) {
        wrap.classList.remove('gs-bloom'); void wrap.offsetWidth; wrap.classList.add('gs-bloom');
      }
      setTimeout(function () { wrap.classList.remove('gs-release'); }, 520);
      if (!cancelled && window.buzz) buzz('good');
      if (opts.onRelease && !cancelled) opts.onRelease(+input.value);
    }
    wrap.addEventListener('pointerup', function (e) { end(e, false); });
    wrap.addEventListener('pointercancel', function (e) { end(e, true); });
    input.addEventListener('input', function () { if (!drag) paint(+input.value); });
    input.addEventListener('keydown', function () { wrap.classList.add('gs-release'); setTimeout(function () { wrap.classList.remove('gs-release'); }, 300); });
    if (window.ResizeObserver) new ResizeObserver(sync).observe(track);
    requestAnimationFrame(sync);
    input._gs = { sync: sync, el: wrap };
    return input._gs;
  }
  window.GlowSlider = { enhance: enhance };

  /* ---- the album rating sheet ------------------------------------------ */
  var rs = document.getElementById('rate-slider');
  if (rs) {
    rs.removeAttribute('style');
    enhance(rs, { className: 'gs-album' });
    var rv = document.getElementById('rate-view');
    // Desktop: arrows rate without having to find the slider first.
    document.addEventListener('keydown', function (e) {
      if (!rv || !rv.classList.contains('open') || e.defaultPrevented) return;
      var t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range') || t.isContentEditable)) return;
      if (t === rs) return;   // the focused range already handles its own arrows
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        rs.value = Math.max(0, Math.min(100, +rs.value + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1)));
        rs.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }
})();
