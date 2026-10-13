/* Accessibility follows the same open/close paths as pointer input, so game
   timers, audio, forms and confirmation promises keep their own cleanup. */
(function () {
  var stack = [], returnFocus = new WeakMap(), inerted = new Map(), lastTrigger = null;
  var focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
  function visible(n) { return n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden'; }
  function top() { return stack[stack.length - 1]; }
  // Safari deliberately doesn't focus a button when it is clicked. Remember
  // the actual opener as well as activeElement so close still returns there.
  function remember(e) {
    var node = e.target.closest && e.target.closest('button, a, input, textarea, select, [tabindex]');
    if (node) lastTrigger = { node: node, at: performance.now() };
  }
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') remember(e); }, true);
  function previousFocus(layer) {
    var node = returnFocus.get(layer);
    if (node && !node.isConnected && node.id) node = document.getElementById(node.id);
    return node && node.isConnected && visible(node) ? node : null;
  }
  function focusLayer(layer) {
    if (!layer || layer.contains(document.activeElement)) return;
    var close = layer.querySelector('.modal-close, [id$="-close"]');
    (close && visible(close) ? close : layer).focus({ preventScroll: true });
  }
  function sync() {
    var layers = Array.from(document.querySelectorAll('.modal.open, .activity.open, .onb.open'));
    var closed = stack.filter(function (n) { return layers.indexOf(n) < 0; });
    stack = stack.filter(function (n) { return layers.indexOf(n) >= 0; });
    layers.forEach(function (n) {
      if (stack.indexOf(n) >= 0) return;
      var trigger = lastTrigger && performance.now() - lastTrigger.at < 1000 && !n.contains(lastTrigger.node) ? lastTrigger.node : document.activeElement;
      returnFocus.set(n, trigger);
      stack.push(n);
      n.setAttribute('role', 'dialog'); n.setAttribute('aria-modal', 'true'); n.tabIndex = -1;
      var title = n.id !== 'onb' && n.querySelector('h2, h3, .modal-head, .activity-head');
      if (title) { if (!title.id) title.id = n.id + '-dialog-title'; n.setAttribute('aria-labelledby', title.id); }
      else n.setAttribute('aria-label', n.id === 'onb' ? 'VINALL onboarding' : 'VINALL dialog');
    });
    // on-top confirmations must remain above their parent regardless of DOM order.
    stack.sort(function (a, b) { return Number(a.classList.contains('on-top')) - Number(b.classList.contains('on-top')); });
    inerted.forEach(function (was, n) { n.inert = was; }); inerted.clear();
    var active = top();
    document.documentElement.classList.toggle('layer-open', !!active);
    document.body.classList.toggle('layer-open', !!active);
    if (active) {
      // Walk ancestors too: some sheets live inside .wrap, others are siblings.
      for (var node = active; node && node !== document.body; node = node.parentElement) {
        Array.from(node.parentElement.children).forEach(function (sibling) {
          if (sibling === node || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) return;
          if (!inerted.has(sibling)) { inerted.set(sibling, sibling.inert); sibling.inert = true; }
        });
      }
      var back = closed.length && previousFocus(closed[0]);
      if (back && active.contains(back)) back.focus({ preventScroll: true });
      focusLayer(active);
    } else if (closed.length) {
      var previous = previousFocus(closed[0]);
      if (previous) previous.focus({ preventScroll: true });
    }
  }
  var observer = new MutationObserver(sync);
  document.querySelectorAll('.modal, .activity, .onb').forEach(function (layer) {
    observer.observe(layer, { attributes: true, attributeFilter: ['class'] });
  });
  document.addEventListener('keydown', function (e) {
    var layer = top();
    if (layer && e.key === 'Tab') {
      var items = Array.from(layer.querySelectorAll(focusable)).filter(visible);
      var first = items[0], last = items[items.length - 1];
      if (!first) { e.preventDefault(); layer.focus({ preventScroll: true }); }
      else if (e.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement) || document.activeElement === layer)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      return;
    }
    // Existing Escape handlers get first refusal. Click a real close control
    // for sheets without one; don't bypass a game's close confirmation.
    if (layer && layer.classList.contains('open') && e.key === 'Escape' && !e.defaultPrevented && layer.id !== 'ask-modal') {
      var close = layer.querySelector('.modal-close, [id$="-close"]');
      if (close && !close.disabled) { e.preventDefault(); close.click(); }
      return;
    }
    var t = e.target;
    if (!layer && (e.key === 'Enter' || e.key === ' ') && t && t.matches && t.matches('.game-card, .card[tabindex], [data-open][tabindex], [data-uid][tabindex]') && !t.matches('button, a, input')) {
      e.preventDefault(); t.click();
    }
  });
  document.addEventListener('focusin', function (e) { remember(e); var layer = top(); if (layer && !layer.contains(e.target)) focusLayer(layer); });
  function enhance(root) {
    var selector = '.game-card, .card[data-id], .card[data-reco], [data-open], [data-uid]';
    var nodes = Array.from(root.querySelectorAll(selector));
    if (root.matches && root.matches(selector)) nodes.unshift(root);
    nodes.forEach(function (n) {
      if (/^(BUTTON|A|INPUT|SELECT)$/.test(n.tagName) || n.closest('button, a')) return;
      n.tabIndex = 0;
      // Crate cards contain a remove button, so their container is a group.
      n.setAttribute('role', n.querySelector('button') ? 'group' : 'button');
      var label = n.querySelector('h3, .card-name');
      if (label) n.setAttribute('aria-label', label.textContent.trim());
    });
  }
  enhance(document);
  // Only enhance added subtrees, not every card on every class animation.
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      record.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        enhance(n);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
  sync();
})();
