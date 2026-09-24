// HighFy TV Cache Clearing & Service Worker Reset Guard
(function() {
  var CURRENT_CACHE_KEY = 'highfy_cache_v20260924_card_sync_03';
  var hasRefreshed = localStorage.getItem('highfy_cache_version') === CURRENT_CACHE_KEY;

  if (!hasRefreshed) {
    // Unregister all Service Workers immediately
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (var i = 0; i < registrations.length; i++) {
          registrations[i].unregister();
        }
      }).catch(function() {});
    }

    // Clear all CacheStorage keys
    if (window.caches) {
      caches.keys().then(function(names) {
        for (var i = 0; i < names.length; i++) {
          caches.delete(names[i]);
        }
      }).catch(function() {});
    }

    try {
      sessionStorage.clear();
      localStorage.setItem('highfy_cache_version', CURRENT_CACHE_KEY);
      localStorage.setItem('highfy_theme', 'dark');
    } catch(e) {}

    // Force page reload to get fresh assets
    setTimeout(function() {
      window.location.reload();
    }, 50);
  }
})();

