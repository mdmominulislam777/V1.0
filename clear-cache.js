// HighFy TV Cache Clearing & Service Worker Reset Guard
(function() {
  var CURRENT_CACHE_KEY = 'highfy_cache_v20261002_strict_broadcaster_flow_01';
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
      localStorage.removeItem('highfy_tv_mode');
      localStorage.removeItem('highfy_event_channel_map');
      localStorage.removeItem('highfy_coordinator_events_v26');
      localStorage.removeItem('highfy_coordinator_events_v27');
      localStorage.removeItem('highfy_coordinator_events_v28');
      localStorage.removeItem('highfy_cricket_events_cache_v26');
      localStorage.removeItem('highfy_cricket_events_cache_v27');
      localStorage.removeItem('highfy_thesportsdb_cache_v26');
      localStorage.removeItem('highfy_thesportsdb_cache_v27');
      localStorage.setItem('highfy_cache_version', CURRENT_CACHE_KEY);
      localStorage.setItem('highfy_theme', 'dark');
    } catch(e) {}

    // Force page reload to get fresh assets
    setTimeout(function() {
      window.location.reload();
    }, 50);
  }
})();

