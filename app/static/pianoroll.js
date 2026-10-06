// Editable piano-roll canvas + a minimal WebAudio synth for previewing notes.
// Notes are [pitch, startSeconds, endSeconds, velocity].

const DEFAULT_NOTE_SECONDS = 0.3;
const DEFAULT_VELOCITY = 100;
const RESIZE_HANDLE_PX = 7;

function pitchRange(notes) {
  if (!notes.length) return [60 - 12, 60 + 12];
  let lo = Infinity, hi = -Infinity;
  for (const [p] of notes) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
  return [lo - 1, hi + 1];
}

// One editable roll per track. `onChange(notes)` fires after each discrete edit (not mid-drag).
function createPianoRoll(canvas, { getDuration, onChange, isDrum }) {
  let notes = [];
  let selected = -1;
  let drag = null; // { index, mode: 'move' | 'resize', startX, startY, origStart, origEnd, origPitch }

  function layout() {
    const [lo, hi] = pitchRange(notes);
    const duration = getDuration() || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const rowH = h / (hi - lo + 1);
    return { lo, hi, duration, w, h, rowH };
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const { lo, hi, duration, w, h, rowH } = layout();
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.07)';
    for (let p = Math.ceil(lo / 12) * 12; p <= hi; p += 12) {
      ctx.fillRect(0, (hi - p + 1) * rowH - 0.5, w, 1);
    }
    notes.forEach(([p, s, e, v], i) => {
      const x = (s / duration) * w;
      const width = Math.max(2, ((e - s) / duration) * w);
      const y = (hi - p) * rowH;
      ctx.fillStyle = i === selected
        ? 'rgba(200, 60, 60, 0.9)'
        : `rgba(60, 70, 190, ${0.35 + 0.65 * v / 127})`;
      ctx.fillRect(x, y, width, Math.max(1.5, rowH - 0.5));
    });
  }

  function hitTest(mx, my) {
    const { lo, hi, duration, w, rowH } = layout();
    const time = (mx / w) * duration;
    for (let i = notes.length - 1; i >= 0; i--) {
      const [p, s, e] = notes[i];
      const y = (hi - p) * rowH;
      if (my < y || my > y + rowH) continue;
      if (time < s || time > e) continue;
      const endX = (e / duration) * w;
      const mode = Math.abs(mx - endX) <= RESIZE_HANDLE_PX ? 'resize' : 'move';
      return { index: i, mode };
    }
    return null;
  }

  function xyToTimePitch(mx, my) {
    const { lo, hi, duration, w, rowH } = layout();
    return { time: Math.max(0, (mx / w) * duration), pitch: Math.round(hi - my / rowH) };
  }

  canvas.tabIndex = 0; // so it can receive Delete/Backspace
  canvas.style.cursor = 'crosshair';

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = hitTest(mx, my);
    canvas.focus();

    if (hit) {
      selected = hit.index;
      const [p, s, en] = notes[hit.index];
      drag = { index: hit.index, mode: hit.mode, startX: mx, startMouseTime: xyToTimePitch(mx, my).time, origStart: s, origEnd: en, origPitch: p };
    } else {
      const { time, pitch } = xyToTimePitch(mx, my);
      const note = [pitch, time, time + DEFAULT_NOTE_SECONDS, DEFAULT_VELOCITY];
      notes.push(note);
      selected = notes.length - 1;
      drag = { index: selected, mode: 'resize', startX: mx, startMouseTime: time, origStart: time, origEnd: time + DEFAULT_NOTE_SECONDS, origPitch: pitch };
    }
    draw();
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const { time, pitch } = xyToTimePitch(mx, my);
    const note = notes[drag.index];
    if (!note) return;

    if (drag.mode === 'move') {
      const dt = time - drag.startMouseTime;
      const dur = drag.origEnd - drag.origStart;
      const newStart = Math.max(0, drag.origStart + dt);
      note[0] = pitch;
      note[1] = newStart;
      note[2] = newStart + dur;
    } else {
      note[2] = Math.max(note[1] + 0.03, time);
    }
    draw();
  });

  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const note = notes[drag.index]; // keep the reference across the sort below, not the index
    drag = null;
    notes.sort((a, b) => a[1] - b[1]);
    selected = notes.indexOf(note);
    draw();
    onChange(notes);
  });

  canvas.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) {
      notes.splice(selected, 1);
      selected = -1;
      draw();
      onChange(notes);
      e.preventDefault();
    }
  });

  return {
    setNotes(n) { notes = n.map((x) => x.slice()); selected = -1; draw(); },
    redraw: draw,
  };
}

const synth = {
  ctx: null,
  timer: null,
  scheduledUpTo: 0,
  voices: new Set(),

  // getTime: current song position in seconds; getParts: [{notes, volume, isDrum}] for stems with Synth on.
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
      for (const { notes, volume, isDrum } of getParts()) {
        for (const [p, s, e, v] of notes) {
          if (s >= this.scheduledUpTo && s < horizon) {
            if (isDrum) this.drumVoice(p, s - now, v, volume);
            else this.voice(p, s - now, e - s, v, volume);
          }
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
    this.track(osc);
  },

  // Playing GM drum note numbers as tuned pitches would sound like random
  // beeps, not drums — synthesize a short noise/thump per hit instead.
  drumVoice(pitch, delay, velocity, volume) {
    const when = this.ctx.currentTime + Math.max(0, delay);
    const peak = 0.3 * (velocity / 127) * volume;

    if (pitch === 36) { // kick: pitch-dropping sine thump
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, when);
      osc.frequency.exponentialRampToValueAtTime(40, when + 0.15);
      gain.gain.setValueAtTime(peak, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(when);
      osc.stop(when + 0.22);
      this.track(osc);
      return;
    }
    // snare/hi-hat: filtered noise burst
    const dur = pitch === 42 ? 0.05 : 0.15;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = pitch === 42 ? 'highpass' : 'bandpass';
    filter.frequency.value = pitch === 42 ? 6000 : 1800;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
    noise.connect(filter).connect(gain).connect(this.ctx.destination);
    noise.start(when);
    noise.stop(when + dur + 0.02);
    this.track(noise);
  },

  track(node) {
    this.voices.add(node);
    node.onended = () => this.voices.delete(node);
  },

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const node of this.voices) { try { node.stop(); } catch (e) {} }
    this.voices.clear();
  },
};
