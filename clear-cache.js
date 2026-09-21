if (!sessionStorage.getItem('highfy_cache_cleared_v16')) {
  sessionStorage.setItem('highfy_cache_cleared_v16', 'true');
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
  localStorage.setItem('highfy_theme', 'dark'); // Force dark theme in local storage
  window.location.reload(true);
}
