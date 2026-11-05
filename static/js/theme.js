// Copyright 2026 Insolent Construct. MIT licence: see encoder.js.
(() => {
  const key = 'hygrostat-theme';
  const values = ['system', 'light', 'dark'];
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (values.includes(saved)) preference = saved;
  } catch {
    // A blocked preference store must not prevent using the page.
  }
  const apply = () => {
    document.documentElement.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  };
  apply();
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('theme');
    select.value = preference;
    select.addEventListener('change', () => {
      if (!values.includes(select.value)) return;
      preference = select.value;
      apply();
      try {
        localStorage.setItem(key, preference);
      } catch {
        // The selected theme still works when persistence is unavailable.
      }
    });
  }, { once: true });
})();
