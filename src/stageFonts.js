/** The fonts the editor's stages (rig/stage.js, camp/stage.js) use: one stylesheet link, once per document. */
const FONTS = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700&family=Barlow:wght@400;500&family=JetBrains+Mono:wght@400&display=swap';

export function ensureStageFonts() {
  if (typeof document === 'undefined' || document.querySelector('link[data-stage-fonts]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = FONTS;
  l.dataset.stageFonts = '';
  document.head.appendChild(l);
}
