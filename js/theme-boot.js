// Runs before the page paints so the chosen theme shows immediately (no flash of the default colours).
// The settings in IndexedDB are the source of truth; ui.js mirrors the look settings into localStorage for this.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('zephyr-look') || 'null');
    if (!t) return;
    var r = document.documentElement;
    if (t.palette) r.setAttribute('data-palette', t.palette);
    if (t.appearance === 'light' || t.appearance === 'dark') r.setAttribute('data-theme', t.appearance);
    if (t.textSize && t.textSize !== 'normal') r.setAttribute('data-size', t.textSize);
  } catch (e) {}
})();
