/* global localStorage, window, document */
(function () {
  try {
    var stored = localStorage.getItem("hb.theme") || "system";
    var dark = stored === "dark" || (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {
    /* browser preference unavailable */
  }
})();
