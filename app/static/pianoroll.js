// Piano-roll drawing and a minimal WebAudio synth for previewing transcribed notes.
// Notes are [pitch, startSeconds, endSeconds, velocity], as served by /api/uploads/{id}/midi/{stem}/notes.

function drawRoll(canvas, notes, duration) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (!notes.length || !duration) return;

  let lo = Infinity, hi = -Infinity;
  for (const [p] of notes) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
  lo -= 1; hi += 1;
  const rowH = h / (hi - lo + 1);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.07)';  // a line under every C, as an octave guide
  for (let p = Math.ceil(lo / 12) * 12; p <= hi; p += 12) {
    ctx.fillRect(0, (hi - p + 1) * rowH - 0.5, w, 1);
  }
  for (const [p, s, e, v] of notes) {
    ctx.fillStyle = `rgba(60, 70, 190, ${0.35 + 0.65 * v / 127})`;
    ctx.fillRect(s / duration * w, (hi - p) * rowH, Math.max(1, (e - s) / duration * w), Math.max(1.5, rowH - 0.5));
  }
}

const synth = {
  ctx: null,
  timer: null,
  scheduledUpTo: 0,
  voices: new Set(),

  // getTime: current song position in seconds; getParts: [{notes, volume}] for stems with Synth on.
  start(getTime, isPlaying, getParts) {
    this.stop();
    this.ctx = this.ctx || new AudioContext();
    this.ctx.resume();
    this.scheduledUpTo = getTime();
    const LOOKAHEAD = 0.4;
    const tick = () => {
      if (!isPlaying()) return;
      const now = getTime();
      const horizon = now + LOOKAHEAD;
      for (const { notes, volume } of getParts()) {
        for (const [p, s, e, v] of notes) {
          if (s >= this.scheduledUpTo && s < horizon) this.voice(p, s - now, e - s, v, volume);
        }
      }
      this.scheduledUpTo = horizon;
    };
    tick();
    this.timer = setInterval(tick, 100);
  },

  voice(pitch, delay, dur, velocity, volume) {
    const when = this.ctx.currentTime + Math.max(0, delay);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
    const peak = 0.12 * (velocity / 127) * volume;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.01);
    gain.gain.setValueAtTime(peak, when + Math.max(0.01, dur - 0.03));
    gain.gain.linearRampToValueAtTime(0, when + dur + 0.02);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.05);
    this.voices.add(osc);
    osc.onended = () => this.voices.delete(osc);
  },

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const osc of this.voices) { try { osc.stop(); } catch (e) {} }
    this.voices.clear();
  },
};
