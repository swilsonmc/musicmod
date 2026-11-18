// Editable, zoomable piano roll + a minimal WebAudio synth for previewing notes.
// Notes are [pitch, startSeconds, endSeconds, velocity].
//
// createPianoRoll(container, opts) builds its own DOM (a scrollable viewport,
// an inner element that widens when zoomed, a canvas, and a playhead) inside
// `container`, so all of a roll's rendering/interaction/zoom state lives here
// rather than being split with the caller.

const DEFAULT_NOTE_SECONDS = 0.3;
const DEFAULT_VELOCITY = 100;
const RESIZE_HANDLE_PX = 7;
const MAX_ZOOM = 24;
const MAX_UNDO = 50;

function pitchRange(notes) {
  if (!notes.length) return [60 - 12, 60 + 12];
  let lo = Infinity, hi = -Infinity;
  for (const [p] of notes) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
  return [lo - 1, hi + 1];
}

const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

// Picks a tick spacing (seconds) from a fixed set so ruler labels stay
// readably spaced apart regardless of zoom level, instead of overlapping.
function pickTimeStep(pxWidth, duration) {
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  if (duration <= 0) return 1;
  const pxPerSecond = pxWidth / duration;
  for (const c of candidates) {
    if (c * pxPerSecond >= 55) return c;
  }
  return candidates[candidates.length - 1];
}

function shortTime(t, step) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return step < 1 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${Math.round(s).toString().padStart(2, '0')}`;
}

function createPianoRoll(container, { getDuration, isDrum, onChange }) {
  container.innerHTML = '';

  // A small grid, not just the scrollable canvas: a corner spacer, a time
  // ruler across the top, and a note-name column down the left — a fixed
  // coordinate system to read positions off of (e.g. "1:23, near C4"),
  // independent of whatever the current zoom level happens to be.
  const grid = document.createElement('div');
  grid.className = 'roll-grid';
  const corner = document.createElement('div');
  corner.className = 'roll-corner';
  const rulerWrap = document.createElement('div');
  rulerWrap.className = 'roll-ruler-wrap';
  const rulerCanvas = document.createElement('canvas');
  rulerWrap.appendChild(rulerCanvas);
  const keysWrap = document.createElement('div');
  keysWrap.className = 'roll-keys-wrap';
  const keysCanvas = document.createElement('canvas');
  keysWrap.appendChild(keysCanvas);

  const viewport = document.createElement('div');
  viewport.className = 'roll';
  const inner = document.createElement('div');
  inner.className = 'roll-inner';
  const canvas = document.createElement('canvas');
  const playhead = document.createElement('div');
  playhead.className = 'playhead';
  inner.append(canvas, playhead);
  viewport.append(inner);

  grid.append(corner, rulerWrap, keysWrap, viewport);
  container.appendChild(grid);

  let notes = [];
  let selected = new Set(); // note references (not indices — stable across sort/splice)
  let history = [];
  let zoom = 1; // scales both axes together, so note rows grow along with time width
  let lastPlayheadFrac = 0;
  let drag = null;   // { kind: 'move'|'resize', note, startTime, startPitch, origStart, origEnd }
  let marquee = null; // { x0, y0, x1, y1 } in canvas CSS-pixel space, while ctrl-dragging empty space

  // The ruler/keys panes have overflow:hidden (so they never show their own
  // scrollbar) and are shifted by hand to track the real viewport's scroll —
  // the classic frozen-header/frozen-column trick.
  viewport.addEventListener('scroll', () => {
    rulerCanvas.style.transform = `translateX(${-viewport.scrollLeft}px)`;
    keysCanvas.style.transform = `translateY(${-viewport.scrollTop}px)`;
  });

  function verticalCenterFraction() {
    const innerH = inner.clientHeight || 1;
    return (viewport.scrollTop + viewport.clientHeight / 2) / innerH;
  }

  function restoreVerticalCenter(frac) {
    const innerH = inner.clientHeight || 1;
    const max = Math.max(0, innerH - viewport.clientHeight);
    viewport.scrollTop = Math.max(0, Math.min(max, frac * innerH - viewport.clientHeight / 2));
  }

  // Keeps the current playhead position in view (and centered) across a
  // zoom change — without this, zooming leaves the scroll position in
  // viewport-pixel terms, which no longer corresponds to the same moment in
  // the song once the inner width has changed, so the playhead drifts off.
  function centerOnPlayhead() {
    const innerW = inner.clientWidth || 1;
    const x = lastPlayheadFrac * innerW;
    const max = Math.max(0, innerW - viewport.clientWidth);
    viewport.scrollLeft = Math.max(0, Math.min(max, x - viewport.clientWidth / 2));
  }

  function applyZoom() {
    const baseW = viewport.clientWidth || 1;
    const baseH = viewport.clientHeight || 1;
    inner.style.width = `${Math.round(baseW * zoom)}px`;
    inner.style.height = `${Math.round(baseH * zoom)}px`;
    draw();
    drawRuler();
    drawKeys();
  }

  function rezoom(factor) {
    const vFrac = verticalCenterFraction();
    zoom = Math.max(1, Math.min(MAX_ZOOM, zoom * factor));
    applyZoom();
    centerOnPlayhead();
    restoreVerticalCenter(vFrac);
  }

  function layout() {
    const [lo, hi] = pitchRange(notes);
    const duration = getDuration() || 1;
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
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

    for (let p = lo; p <= hi; p++) {
      if (BLACK_KEY_PITCH_CLASSES.has(((p % 12) + 12) % 12)) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.035)';
        ctx.fillRect(0, (hi - p) * rowH, w, rowH);
      }
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.07)';
    for (let p = Math.ceil(lo / 12) * 12; p <= hi; p += 12) {
      ctx.fillRect(0, (hi - p + 1) * rowH - 0.5, w, 1);
    }
    for (const n of notes) {
      const [p, s, e, v] = n;
      const x = (s / duration) * w;
      const width = Math.max(2, ((e - s) / duration) * w);
      const y = (hi - p) * rowH;
      ctx.fillStyle = selected.has(n) ? 'rgba(200, 60, 60, 0.9)' : `rgba(60, 70, 190, ${0.35 + 0.65 * v / 127})`;
      ctx.fillRect(x, y, width, Math.max(1.5, rowH - 0.5));
    }
    if (marquee) {
      const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
      ctx.fillStyle = 'rgba(60, 70, 190, 0.15)';
      ctx.strokeStyle = 'rgba(60, 70, 190, 0.6)';
      ctx.fillRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      ctx.strokeRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
    }
  }

  function drawRuler() {
    const dpr = window.devicePixelRatio || 1;
    const { duration, w } = layout();
    const h = rulerWrap.clientHeight || 1;
    // Set in actual CSS px here, not via a CSS percentage: this canvas must
    // span the full (possibly zoomed-wide) inner width while its wrap stays
    // small and clipped, which a parent-relative percentage can't express.
    rulerCanvas.style.width = `${w}px`;
    rulerCanvas.style.height = `${h}px`;
    rulerCanvas.width = w * dpr;
    rulerCanvas.height = h * dpr;
    const ctx = rulerCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const step = pickTimeStep(w, duration);
    for (let t = 0; t <= duration; t += step) {
      const x = (t / duration) * w;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, h - 5);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
      ctx.fillStyle = '#666';
      ctx.fillText(shortTime(t, step), x + 2, 2);
    }
  }

  function drawKeys() {
    const dpr = window.devicePixelRatio || 1;
    const { lo, hi, rowH } = layout();
    const w = keysWrap.clientWidth || 1;
    const h = inner.clientHeight || 1;
    // Same reasoning as drawRuler(): this canvas must span the full
    // (possibly zoomed-tall) inner height, set explicitly rather than via a
    // CSS percentage of its small, clipped wrap.
    keysCanvas.style.width = `${w}px`;
    keysCanvas.style.height = `${h}px`;
    keysCanvas.width = w * dpr;
    keysCanvas.height = h * dpr;
    const ctx = keysCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '9px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let p = lo; p <= hi; p++) {
      const pitchClass = ((p % 12) + 12) % 12;
      const isC = pitchClass === 0;
      const y0 = (hi - p) * rowH;
      if (BLACK_KEY_PITCH_CLASSES.has(pitchClass)) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.035)';
        ctx.fillRect(0, y0, w, rowH);
      }
      // Only label rows that have room to show text without overlapping —
      // always C (the octave anchor), every semitone once rows are tall enough.
      if (isC || rowH >= 13) {
        ctx.fillStyle = isC ? '#333' : '#999';
        ctx.fillText(noteName(p), 3, y0 + rowH / 2);
      }
      if (isC) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        ctx.moveTo(0, y0 + rowH - 0.5);
        ctx.lineTo(w, y0 + rowH - 0.5);
        ctx.stroke();
      }
    }
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
      return { note: notes[i], mode: Math.abs(mx - endX) <= RESIZE_HANDLE_PX ? 'resize' : 'move' };
    }
    return null;
  }

  function xyToTimePitch(mx, my) {
    const { lo, hi, duration, w, rowH } = layout();
    const pitch = Math.round(hi - my / rowH);
    return { time: Math.max(0, (mx / w) * duration), pitch: Math.max(0, Math.min(127, pitch)) };
  }

  function pushHistory() {
    history.push(notes.map((n) => n.slice()));
    if (history.length > MAX_UNDO) history.shift();
  }

  function commit() {
    notes.sort((a, b) => a[1] - b[1]);
    draw();
    drawKeys(); // pitch range (and so row height/labels) can shift with an edit
    onChange(notes.map((n) => n.slice()));
  }

  // e.offsetX/Y are computed by the browser at the moment the event fired,
  // relative to the target element — unlike a getBoundingClientRect() call
  // made later, they can't be thrown off by a layout shift that happens in
  // between (concretely: canvas.focus() below can make the browser
  // auto-scroll the page if the roll wasn't fully in view, which moves the
  // canvas's rect between dispatch and handling — this corrupted note pitch
  // by over a hundred semitones when reproduced, hence belt-and-suspenders
  // with the clamp in xyToTimePitch() too).
  function mousePos(e) {
    if (e.target === canvas && typeof e.offsetX === 'number') return { mx: e.offsetX, my: e.offsetY };
    const rect = canvas.getBoundingClientRect();
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
  }

  canvas.tabIndex = 0;
  canvas.style.cursor = 'crosshair';

  canvas.addEventListener('mousedown', (e) => {
    const { mx, my } = mousePos(e);
    canvas.focus();

    if (e.ctrlKey || e.metaKey) {
      const hit = hitTest(mx, my);
      if (hit && !e.shiftKey) {
        // Ctrl+click on a note: toggle it in/out of the multi-selection.
        if (selected.has(hit.note)) selected.delete(hit.note); else selected.add(hit.note);
        draw();
      } else {
        marquee = { x0: mx, y0: my, x1: mx, y1: my };
      }
      e.preventDefault();
      return;
    }

    const hit = hitTest(mx, my);
    if (hit) {
      if (!selected.has(hit.note)) selected = new Set([hit.note]);
      pushHistory();
      const [p, s, en] = hit.note;
      drag = { kind: hit.mode, note: hit.note, startTime: xyToTimePitch(mx, my).time, origStart: s, origEnd: en, origPitch: p };
    } else {
      selected = new Set();
      pushHistory();
      const { time, pitch } = xyToTimePitch(mx, my);
      const note = [pitch, time, time + DEFAULT_NOTE_SECONDS, DEFAULT_VELOCITY];
      notes.push(note);
      selected = new Set([note]);
      drag = { kind: 'resize', note, startTime: time, origStart: time, origEnd: time + DEFAULT_NOTE_SECONDS, origPitch: pitch };
    }
    draw();
    drawKeys();
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (marquee) {
      const { mx, my } = mousePos(e);
      marquee.x1 = mx;
      marquee.y1 = my;
      draw();
      return;
    }
    if (!drag) return;
    const { mx, my } = mousePos(e);
    const { time, pitch } = xyToTimePitch(mx, my);
    const note = drag.note;

    if (drag.kind === 'move') {
      const dt = time - drag.startTime;
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
    if (marquee) {
      const { lo, hi, duration, w, rowH } = layout();
      const x0 = Math.min(marquee.x0, marquee.x1), x1 = Math.max(marquee.x0, marquee.x1);
      const y0 = Math.min(marquee.y0, marquee.y1), y1 = Math.max(marquee.y0, marquee.y1);
      for (const n of notes) {
        const [p, s, e] = n;
        const nx0 = (s / duration) * w, nx1 = (e / duration) * w;
        const ny = (hi - p) * rowH;
        if (nx1 >= x0 && nx0 <= x1 && ny + rowH >= y0 && ny <= y1) selected.add(n);
      }
      marquee = null;
      draw();
      return;
    }
    if (!drag) return;
    const editedNote = drag.note;
    drag = null;
    commit();
    previewNote(editedNote);
  });

  canvas.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
      pushHistory();
      notes = notes.filter((n) => !selected.has(n));
      selected = new Set();
      commit();
      e.preventDefault();
    }
  });

  function previewNote(note) {
    const [pitch, , , velocity] = note;
    synth.previewOne(pitch, velocity, isDrum);
  }

  return {
    setNotes(n) {
      notes = n.map((x) => x.slice());
      selected = new Set();
      history = [];
      applyZoom();
    },
    getNotes() { return notes.map((n) => n.slice()); },
    undo() {
      if (!history.length) return false;
      notes = history.pop();
      selected = new Set();
      draw();
      drawKeys();
      onChange(notes.map((n) => n.slice()));
      return true;
    },
    hasUndo() { return history.length > 0; },
    redraw: applyZoom,
    zoomIn() { rezoom(1.6); },
    zoomOut() { rezoom(1 / 1.6); },
    // rezoom() always clamps to exactly 1 or exactly MAX_ZOOM at the
    // limits, so these comparisons never need an epsilon.
    zoomState() { return { atMin: zoom <= 1, atMax: zoom >= MAX_ZOOM }; },
    setPlayheadFraction(f) {
      lastPlayheadFrac = Math.max(0, Math.min(1, f));
      playhead.style.left = `${lastPlayheadFrac * 100}%`;
    },
  };
}

const synth = {
  ctx: null,
  timer: null,
  scheduledUpTo: 0,
  voices: new Set(),

  ensureContext() {
    // Shares the playback engine's AudioContext (one clock for everything
    // that makes sound here) instead of creating a second, separate one.
    this.ctx = engine.ensureContext();
    this.ctx.resume();
    return this.ctx;
  },

  // getTime: current song position in seconds; getParts: [{notes, volume, isDrum}] for stems with Synth on.
  start(getTime, isPlaying, getParts) {
    this.stop();
    this.ensureContext();
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

  // A one-shot sound for a note you just added/moved/resized, independent of
  // the transport — so editing is audible even when nothing is playing.
  previewOne(pitch, velocity, isDrum) {
    this.ensureContext();
    if (isDrum) this.drumVoice(pitch, 0, velocity, 1);
    else this.voice(pitch, 0, 0.35, velocity, 1);
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
