if (!sessionStorage.getItem('highfy_cache_cleared_v18_watermark')) {
  sessionStorage.setItem('highfy_cache_cleared_v18_watermark', 'true');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
      for(let registration of registrations) {
        registration.unregister();
      }
    });
  }
  if (window.caches) {
    caches.keys().then(function(names) {
      for (let name of names) caches.delete(name);
    });
  }
  localStorage.setItem('highfy_theme', 'dark');
  window.location.reload();
}
