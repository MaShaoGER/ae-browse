(function () {
  'use strict';
  var main = document.querySelector('main'), divider = document.getElementById('pane-divider');
  var ratio = .64, dragging = false, narrow = window.matchMedia('(max-width: 550px)');
  var wasNarrow = narrow.matches;
  function storageKey() { return narrow.matches ? 'ae-browse-pane-ratio-narrow' : 'ae-browse-pane-ratio'; }
  function restore() { var value = narrow.matches ? .52 : .64; try { var saved = Number(localStorage.getItem(storageKey())); if (saved >= .25 && saved <= .75) value = saved; } catch (_) {} return value; }
  ratio = restore();
  function apply(value, save) {
    ratio = Math.max(.25, Math.min(.75, value));
    main.style.setProperty('--catalog-share', (ratio * 100) + '%');
    divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    divider.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
    if (save) { try { localStorage.setItem(storageKey(), String(ratio)); } catch (_) {} }
  }
  function move(event) {
    if (!dragging) return;
    var rect = main.getBoundingClientRect();
    apply(narrow.matches ? (event.clientY - rect.top) / rect.height : (event.clientX - rect.left) / rect.width, false);
  }
  function end(event) {
    if (!dragging) return; dragging = false;
    document.body.classList.remove('resizing-panes');
    if (event && divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    apply(ratio, true);
  }
  divider.addEventListener('pointerdown', function (event) { if(event.button !== 0) return; dragging = true; divider.setPointerCapture(event.pointerId); document.body.classList.add('resizing-panes'); event.preventDefault(); });
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
  divider.addEventListener('lostpointercapture', function () { end(); });
  window.addEventListener('blur', function () { end(); });
  divider.addEventListener('dblclick', function () { apply(narrow.matches ? .52 : .64, true); });
  divider.addEventListener('keydown', function (event) {
    var delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -.025 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? .025 : 0;
    if (delta || event.key === 'Home') { event.preventDefault(); var value = ratio + delta; if (event.key === 'Home') value = narrow.matches ? .52 : .64; apply(value, true); }
  });
  window.addEventListener('resize', function () { if (wasNarrow !== narrow.matches) { wasNarrow = narrow.matches; ratio = restore(); } apply(ratio, false); });
  apply(ratio, false);
})();
