(() => {
  try {
    ['log','info','debug','warn','error'].forEach(m => {
      if (console[m]) console[m] = () => {};
    });
    window.addEventListener('error', e => { e.preventDefault(); });
    window.addEventListener('unhandledrejection', e => { e.preventDefault(); });
  } catch(_) {}
})(); 