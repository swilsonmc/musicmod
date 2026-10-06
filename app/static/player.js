const uploadsList = document.getElementById('uploads');
const playerDiv = document.getElementById('player');
const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');

let tracks = {}; // stem_name -> { wavesurfer, muted, soloed, volume, notes, lastSaved, dirty, synthOn, isDrum, roll, timeEl }
let pollTimer = null;
let tickTimer = null;
let transcribeTimer = null;
let masterTickTimer = null;
let lastEditedRoll = null; // target of Ctrl+Z, whichever roll was most recently edited

const METHOD_LABEL = {
  basic_pitch: 'Basic Pitch (polyphonic)',
  pyin: 'pYIN (single melody line)',
  onset_classify: 'onset + spectral heuristic (experimental, unverified — see HANDOFF.md)',
};

async function fetchUploads() {
  const res = await fetch('/api/uploads');
  return res.json();
}

function renderUploads(uploads, selectedId) {
  uploadsList.innerHTML = '';
  for (const u of uploads) {
    const li = document.createElement('li');
    li.textContent = `#${u.id} ${u.original_filename} — `;
    const status = document.createElement('span');
    status.className = `status-${u.status}`;
    status.textContent = u.status + (u.error ? `: ${u.error}` : '');
    li.appendChild(status);
    if (u.id === selectedId) li.classList.add('selected');
    li.onclick = () => selectUpload(u.id);
    uploadsList.appendChild(li);
  }
}

async function refreshList(selectedId) {
  const uploads = await fetchUploads();
  renderUploads(uploads, selectedId);
  return uploads;
}

function stopTimers() {
  for (const t of [pollTimer, tickTimer, transcribeTimer, masterTickTimer]) if (t) clearInterval(t);
  pollTimer = tickTimer = transcribeTimer = masterTickTimer = null;
}

// Without this, switching uploads leaves the previous song's audio playing invisibly.
function teardownPlayer() {
  synth.stop();
  for (const t of Object.values(tracks)) t.wavesurfer.destroy();
  tracks = {};
  lastEditedRoll = null;
}

function metaRow(upload, extra = '') {
  return `
    <dl class="status-box-dl">
      <dt>File</dt><dd>${escapeHtml(upload.original_filename)} (${formatBytes(upload.file_size_bytes)})</dd>
      <dt>Started</dt><dd>${formatTime(upload.started_at)}</dd>
      ${extra}
    </dl>`;
}

async function selectUpload(id) {
  stopTimers();
  history.replaceState(null, '', `?upload=${id}`);
  const uploads = await refreshList(id);
  const upload = uploads.find((u) => u.id === id);
  if (!upload) return;

  if (upload.status === 'pending' || upload.status === 'processing') {
    teardownPlayer();
    renderInProgress(upload);
    pollTimer = setInterval(() => selectUpload(id), 3000);
    return;
  }
  if (upload.status === 'error') {
    teardownPlayer();
    playerDiv.innerHTML = `
      <div class="status-box">
        ${metaRow(upload, `<dt>Failed</dt><dd>${formatTime(upload.finished_at)}</dd>`)}
        <p class="status-error">${escapeHtml(upload.error)}</p>
      </div>`;
    return;
  }

  const detail = await fetch(`/api/uploads/${id}`).then((r) => r.json());
  renderDone(detail);
}

function renderInProgress(upload) {
  playerDiv.innerHTML = `
    <div class="status-box">
      ${metaRow(upload)}
      <p><strong>What's happening:</strong> <span id="progress-text">${escapeHtml(upload.progress || 'Waiting to start…')}</span></p>
      <p>Elapsed: <span id="elapsed-text">—</span></p>
    </div>`;

  const startedAt = upload.started_at ? new Date(upload.started_at) : null;
  const elapsedEl = document.getElementById('elapsed-text');
  const tick = () => {
    elapsedEl.textContent = startedAt ? formatDuration(Date.now() - startedAt) : 'not started yet';
  };
  tick();
  tickTimer = setInterval(tick, 1000);
}

function renderTranscribeBox(box, upload) {
  const s = upload.transcribe_status;
  const took = (upload.transcribe_started_at && upload.transcribe_finished_at)
    ? formatDuration(new Date(upload.transcribe_finished_at) - new Date(upload.transcribe_started_at)) : '—';
  let text, button = null;
  if (s === 'pending' || s === 'processing') {
    text = `<strong>Transcribing:</strong> ${escapeHtml(upload.transcribe_progress || 'Queued')}`;
  } else if (s === 'done') {
    text = `<strong>Transcribed to MIDI</strong> in ${took} (${formatTime(upload.transcribe_finished_at)}).`;
    button = 'Re-transcribe';
  } else if (s === 'error') {
    text = `<span class="status-error">Transcription failed: ${escapeHtml(upload.transcribe_error)}</span>`;
    button = 'Try again';
  } else {
    text = 'Not transcribed to MIDI yet. Takes about a minute.';
    button = 'Transcribe to MIDI';
  }
  box.innerHTML = `<p>${text}</p>`;
  if (button) {
    const btn = document.createElement('button');
    btn.textContent = button;
    btn.onclick = () => startTranscription(upload.id, box);
    box.appendChild(btn);
  }
}

async function startTranscription(id, box) {
  const res = await fetch(`/api/uploads/${id}/transcribe`, { method: 'POST' });
  if (!res.ok) {
    box.insertAdjacentHTML('beforeend', `<p class="status-error">${escapeHtml((await res.json()).detail)}</p>`);
    return;
  }
  watchTranscription(id, box);
}

// Updates only the status box while running, so the waveforms aren't reloaded every few seconds.
function watchTranscription(id, box) {
  if (transcribeTimer) clearInterval(transcribeTimer);
  const check = async () => {
    const upload = await fetch(`/api/uploads/${id}`).then((r) => r.json());
    if (upload.transcribe_status === 'done') {
      clearInterval(transcribeTimer);
      transcribeTimer = null;
      renderDone(upload);
    } else {
      renderTranscribeBox(box, upload);
      if (upload.transcribe_status === 'error') { clearInterval(transcribeTimer); transcribeTimer = null; }
    }
  };
  check();
  transcribeTimer = setInterval(check, 3000);
}

function songDuration() {
  return Math.max(0, ...Object.values(tracks).map((t) => t.wavesurfer.getDuration() || 0));
}

function songTime() {
  const first = Object.values(tracks)[0];
  return first ? first.wavesurfer.getCurrentTime() : 0;
}

function anyPlaying() {
  return Object.values(tracks).some((t) => t.wavesurfer.isPlaying());
}

function seekAll(time) {
  for (const t of Object.values(tracks)) t.wavesurfer.setTime(time);
  restartSynthIfPlaying();
}

function synthParts() {
  return Object.values(tracks)
    .filter((t) => t.synthOn && t.notes)
    .map((t) => ({ notes: t.notes, volume: t.volume, isDrum: t.isDrum }));
}

function restartSynthIfPlaying() {
  synth.stop();
  if (anyPlaying() && synthParts().length) synth.start(songTime, anyPlaying, synthParts);
}

function updateTimecodes() {
  const master = document.getElementById('master-time');
  if (!master) return;
  const duration = songDuration();
  const now = songTime();
  master.textContent = `${formatTimecode(now)} / ${formatTimecode(duration)}`;
  const fill = document.getElementById('master-bar-fill');
  if (fill) fill.style.width = duration ? `${(now / duration) * 100}%` : '0%';
  for (const t of Object.values(tracks)) {
    const d = t.wavesurfer.getDuration();
    if (t.timeEl) t.timeEl.textContent = formatTimecode(t.wavesurfer.getCurrentTime());
    if (t.roll) t.roll.setPlayheadFraction(d ? t.wavesurfer.getCurrentTime() / d : 0);
  }
}

// Undo targets whichever roll was edited most recently, regardless of which
// stem's canvas has focus — simpler and more predictable than per-element undo.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    if (lastEditedRoll && lastEditedRoll.hasUndo()) {
      e.preventDefault();
      lastEditedRoll.undo();
    }
  }
});

function renderDone(upload) {
  teardownPlayer();
  playerDiv.innerHTML = '';

  const durationMs = (upload.started_at && upload.finished_at)
    ? new Date(upload.finished_at) - new Date(upload.started_at)
    : null;

  const summary = document.createElement('div');
  summary.className = 'status-box';
  summary.innerHTML = metaRow(upload, `
    <dt>Finished</dt><dd>${formatTime(upload.finished_at)}</dd>
    <dt>Took</dt><dd>${formatDuration(durationMs)}</dd>
  `);
  const transcribeBox = document.createElement('div');
  transcribeBox.className = 'transcribe-box';
  summary.appendChild(transcribeBox);
  renderTranscribeBox(transcribeBox, upload);
  playerDiv.appendChild(summary);
  if (upload.transcribe_status === 'pending' || upload.transcribe_status === 'processing') {
    watchTranscription(upload.id, transcribeBox);
  }

  // --- Master transport: controls in one row, the seek bar in its own row
  // directly below, inset to line up with every stem's waveform/roll. ---
  const transport = document.createElement('div');
  transport.className = 'master-transport';
  transport.innerHTML = `
    <div class="master-buttons">
      <button id="play-all">Play all</button>
      <button id="pause-all">Pause all</button>
      <button id="stop-all">Stop all</button>
      <span class="time-readout" id="master-time">0:00.00 / 0:00.00</span>
    </div>
    <div class="master-bar-row" id="master-bar"><div class="master-bar-fill" id="master-bar-fill"></div></div>
  `;
  playerDiv.appendChild(transport);
  transport.querySelector('#play-all').onclick = () => {
    Object.values(tracks).forEach((t) => t.wavesurfer.play());
    if (synthParts().length) synth.start(songTime, anyPlaying, synthParts);
  };
  transport.querySelector('#pause-all').onclick = () => {
    synth.stop();
    Object.values(tracks).forEach((t) => t.wavesurfer.pause());
  };
  transport.querySelector('#stop-all').onclick = () => {
    synth.stop();
    Object.values(tracks).forEach((t) => t.wavesurfer.stop());
    updateTimecodes();
  };
  transport.querySelector('#master-bar').onclick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekAll(((e.clientX - rect.left) / rect.width) * songDuration());
  };
  masterTickTimer = setInterval(updateTimecodes, 100);

  for (const [stemName, url] of Object.entries(upload.stems)) {
    const midi = upload.midi[stemName];
    const isDrum = stemName === 'drums';
    const track = document.createElement('div');
    track.className = 'track';

    // Appended before .track-main so it renders to the left of the roll, as requested.
    const side = document.createElement('div');
    side.className = 'track-side';
    track.appendChild(side);

    const main = document.createElement('div');
    main.className = 'track-main';
    track.appendChild(main);

    const controls = document.createElement('div');
    controls.className = 'track-controls';
    const label = document.createElement('span');
    label.className = 'stem-label';
    label.textContent = stemName;
    const timeEl = document.createElement('span');
    timeEl.className = 'track-time';
    timeEl.textContent = '0:00.00';
    const muteBtn = document.createElement('button');
    muteBtn.textContent = 'Mute';
    const soloBtn = document.createElement('button');
    soloBtn.textContent = 'Solo';
    const volume = document.createElement('input');
    Object.assign(volume, { type: 'range', min: 0, max: 1, step: 0.01, value: 1 });
    controls.append(label, timeEl, muteBtn, soloBtn, volume);

    let synthBtn = null;
    if (midi) {
      synthBtn = document.createElement('button');
      synthBtn.textContent = 'Synth';
      synthBtn.title = 'Also play the transcribed notes through a simple synth, to compare against the real audio';
      const link = document.createElement('a');
      link.href = midi.url;
      link.textContent = 'MIDI ↓';
      link.title = 'Download this stem as a standard MIDI file';
      controls.append(synthBtn, link);
    }

    const waveformDiv = document.createElement('div');
    waveformDiv.className = 'track-waveform';
    main.append(controls, waveformDiv);

    const wavesurfer = WaveSurfer.create({ container: waveformDiv, height: 60, url });
    const t = tracks[stemName] = {
      wavesurfer, muted: false, soloed: false, volume: 1, notes: null, lastSaved: null, dirty: false,
      synthOn: false, isDrum, roll: null, timeEl,
    };

    // Clicking one waveform used to move only that stem, putting the others out of sync.
    wavesurfer.on('interaction', (time) => seekAll(time));
    wavesurfer.on('finish', () => { if (!anyPlaying()) synth.stop(); });

    if (midi) {
      const rollContainer = document.createElement('div');
      const caption = document.createElement('div');
      caption.className = 'caption';
      caption.textContent = 'loading…';
      const hint = document.createElement('div');
      hint.className = 'caption hint';
      hint.textContent = 'Click empty space to add a note, drag to move/resize, Ctrl+drag to select many, Delete to remove, Ctrl+Z to undo.';
      main.append(rollContainer, caption, hint);

      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      const revertBtn = document.createElement('button');
      revertBtn.textContent = 'Revert';
      const zoomInBtn = document.createElement('button');
      zoomInBtn.textContent = '🔍+';
      zoomInBtn.title = 'Zoom in on this piano roll';
      const zoomOutBtn = document.createElement('button');
      zoomOutBtn.textContent = '🔍−';
      zoomOutBtn.title = 'Zoom out on this piano roll';
      side.append(saveBtn, revertBtn, zoomInBtn, zoomOutBtn);

      const roll = createPianoRoll(rollContainer, {
        getDuration: () => wavesurfer.getDuration(),
        isDrum,
        onChange: (notes) => {
          t.notes = notes;       // live, so Synth hears edits immediately — no server round trip needed
          t.dirty = true;
          lastEditedRoll = roll;
          updateCaption();
        },
      });
      t.roll = roll;

      function updateCaption() {
        const base = describeNotes(stemName, t.notes || [], midi.method);
        caption.textContent = t.dirty ? `${base} · unsaved changes (Save to keep, Revert to discard)` : `${base} · saved`;
        caption.classList.toggle('dirty', t.dirty);
      }

      saveBtn.onclick = async () => {
        caption.textContent = 'Saving…';
        try {
          const res = await fetch(`/api/uploads/${upload.id}/midi/${stemName}/notes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: t.notes }),
          });
          if (!res.ok) throw new Error(await res.text());
          t.lastSaved = t.notes.map((n) => n.slice());
          t.dirty = false;
          updateCaption();
        } catch (err) {
          caption.textContent = 'Save failed — try again.';
        }
      };
      revertBtn.onclick = () => {
        if (!t.lastSaved) return;
        roll.setNotes(t.lastSaved);
        t.notes = t.lastSaved.map((n) => n.slice());
        t.dirty = false;
        updateCaption();
      };
      zoomInBtn.onclick = () => roll.zoomIn();
      zoomOutBtn.onclick = () => roll.zoomOut();

      Promise.all([
        fetch(midi.notes_url).then((r) => r.json()),
        new Promise((resolve) => wavesurfer.once('ready', resolve)),
      ]).then(([{ notes }]) => {
        t.notes = notes;
        t.lastSaved = notes.map((n) => n.slice());
        roll.setNotes(notes);
        updateCaption();
      });

      synthBtn.onclick = () => {
        t.synthOn = !t.synthOn;
        synthBtn.style.fontWeight = t.synthOn ? 'bold' : 'normal';
        restartSynthIfPlaying();
      };
    } else if (upload.untranscribable.includes(stemName) && upload.transcribe_status === 'done') {
      const caption = document.createElement('div');
      caption.className = 'caption';
      caption.textContent = 'No MIDI for this stem.';
      main.appendChild(caption);
    }

    playerDiv.appendChild(track);

    muteBtn.onclick = () => {
      t.muted = !t.muted;
      muteBtn.style.fontWeight = t.muted ? 'bold' : 'normal';
      applyMix();
    };
    soloBtn.onclick = () => {
      t.soloed = !t.soloed;
      soloBtn.style.fontWeight = t.soloed ? 'bold' : 'normal';
      applyMix();
    };
    volume.oninput = () => {
      t.volume = parseFloat(volume.value);
      applyMix();
    };
  }

  alignMasterBar();
}

// The .track-side button column's width depends on its content (font,
// emoji rendering), not a fixed number — so instead of a hardcoded CSS
// margin, measure where a real waveform actually starts/ends and match
// the master seek bar to it exactly.
function alignMasterBar() {
  const bar = document.getElementById('master-bar');
  const waveform = document.querySelector('.track-waveform');
  if (!bar || !waveform) return;
  const barParentLeft = bar.parentElement.getBoundingClientRect().left;
  const wfRect = waveform.getBoundingClientRect();
  bar.style.marginLeft = `${wfRect.left - barParentLeft}px`;
  bar.style.marginRight = `${bar.parentElement.getBoundingClientRect().right - wfRect.right}px`;
}

function describeNotes(stemName, notes, method) {
  const label = METHOD_LABEL[method] || method;
  if (stemName === 'drums') return `${notes.length} hits · ${label}`;
  const pitches = notes.map((n) => n[0]);
  return `${notes.length} notes · ${label}` +
    (notes.length ? ` · range ${noteName(Math.min(...pitches))}–${noteName(Math.max(...pitches))}` : '');
}

function applyMix() {
  const anySoloed = Object.values(tracks).some((t) => t.soloed);
  for (const t of Object.values(tracks)) {
    const audible = !t.muted && (!anySoloed || t.soloed);
    t.wavesurfer.setVolume(audible ? t.volume : 0);
  }
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    Object.values(tracks).forEach((t) => t.roll && t.roll.redraw());
    alignMasterBar();
  }, 150);
});

form.onsubmit = async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', body });
  const { id } = await res.json();
  fileInput.value = '';
  await selectUpload(id);
};

const initialId = new URLSearchParams(location.search).get('upload');
if (initialId) {
  selectUpload(Number(initialId));
} else {
  refreshList(null);
}
