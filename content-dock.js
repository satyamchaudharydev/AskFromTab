// Thin entrypoint: initialize dock after helper modules are loaded.
(function initTab2ChatGPTDockEntry() {
  const initDock = window.__T2C_DOCK__?.initDock;
  if (typeof initDock === 'function') {
    initDock();
  }
})();
