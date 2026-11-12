/**
 * Radio traffic: a squelch, the message spoken by the browser's speech synthesis (quick and a
 * little pitched, like a voice over a handset), and the squelch tail. Replies get a lower voice.
 * Needs a user gesture first (browser autoplay rules); silently does nothing where audio or
 * speech is not available (Node, locked-down frames).
 */
let ctx = null;
let enabled = true;
export function setRadioSound(v) {
  enabled = v;
  if (!v) globalThis.speechSynthesis?.cancel?.();
}

function squelch(t, tail) {
  const n = ctx.sampleRate * 0.2;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1700;
  bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.25, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + (tail ? 0.18 : 0.12));
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.2);
  if (!tail) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.value = 1150;
    og.gain.setValueAtTime(0.08, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(og).connect(ctx.destination);
    o.start(t + 0.02);
    o.stop(t + 0.1);
  }
}

/** Say a radio message. reply: the other end (a different, lower voice). */
export function radioSay(text, { reply = false } = {}) {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ctx ??= new AC();
      if (ctx.state === 'suspended') ctx.resume();
      squelch(ctx.currentTime, false);
    }
    const ss = window.speechSynthesis;
    if (!ss) return;
    const u = new SpeechSynthesisUtterance(text.replace(/·/g, ',').toLowerCase());
    u.rate = 1.12;
    u.pitch = reply ? 0.7 : 1.05;
    u.volume = 0.9;
    const voices = ss.getVoices().filter((v) => /^en/i.test(v.lang));
    if (voices.length) u.voice = voices[reply ? Math.min(voices.length - 1, 1) : 0];
    u.onend = () => ctx && squelch(ctx.currentTime, true);
    ss.speak(u);
  } catch {
    // no audio here
  }
}
