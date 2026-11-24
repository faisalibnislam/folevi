// Debug builds only (App/Memory.swift): when Quick Add's field first shows, by the page's clock in milliseconds since
// 1970 (window.__foleviProbe.field), so a script can time an open from the app's own show (QuickAddPanel.shownAt).
if (location.pathname === "/quick-add") {
  var probe = (window.__foleviProbe = { start: performance.timeOrigin, field: null });
  var seen = function () {
    if (probe.field || !document.getElementById("qa-title")) return false;
    probe.field = performance.timeOrigin + performance.now();
    return true;
  };
  var watch = new MutationObserver(function () {
    if (seen()) watch.disconnect();
  });
  watch.observe(document, { childList: true, subtree: true });
}
