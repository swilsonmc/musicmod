const uploadsList = document.getElementById('uploads');
const playerDiv = document.getElementById('player');
const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');
const uploadsHeading = document.getElementById('uploads-heading');
const playerHeading = document.getElementById('player-heading');

uploadsHeading.onclick = () => {
  uploadsList.classList.toggle('collapsed');
  uploadsHeading.classList.toggle('collapsed');
};

// Called once something is actually about to be shown in the player area
// (a selected upload, or a video's extraction status) — reveals the
// "Player" heading (hidden until then, since an empty section with nothing
// selected doesn't need a heading) and tucks the uploads list away so it
// doesn't compete for space with what the user just chose to look at.
// Still just a click away via the "Uploads" heading above.
function showPlayer() {
  playerHeading.style.display = '';
  uploadsList.classList.add('collapsed');
  uploadsHeading.classList.add('collapsed');
}

let tracks = {}; // stem_name -> { wavesurfer, muted, soloed, volume, notes, lastSaved, dirty, synthOn, isDrum, roll, timeEl }
let pollTimer = null;
let tickTimer = null;
let transcribeTimer = null;
let masterTickTimer = null;
let lastEditedRoll = null; // target of Ctrl+Z, whichever roll was most recently edited
let currentlyShownId = null; // last upload id we auto-collapsed the list for (see selectUpload)

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
  engine.reset();
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
  // Only auto-collapse on an actual new selection, not on this same
  // function's own 3s self-poll while an upload is still processing —
  // otherwise a manual reopen to glance at the list mid-processing would
  // get fought shut again within a few seconds.
  if (id !== currentlyShownId) {
    currentlyShownId = id;
    showPlayer();
  }

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
      <p><strong>What's happening:</strong> <span id="progress-text">${escapeHtml(upload.progress ? formatProgress(upload.progress) : 'Waiting to start…')}</span></p>
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
    text = `<strong>Transcribing:</strong> ${escapeHtml(upload.transcribe_progress ? formatProgress(upload.transcribe_progress) : 'Queued')}`;
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

// Playback position/state now comes from `engine` (one shared AudioContext
// clock — see audioengine.js) instead of each stem's own WaveSurfer, which
// is what used to let stems drift apart: every <audio> element has its own
// independent clock. WaveSurfer instances stay for drawing waveforms and
// click-to-seek only; they're muted and never produce sound themselves.
function songDuration() {
  return engine.duration;
}

function songTime() {
  return engine.currentTime();
}

function anyPlaying() {
  return engine.playing;
}

function seekAll(time) {
  engine.seek(time);
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

// Shared by the merged Play/Pause button and the spacebar shortcut, so a
// click and a keypress always land on the same button-swap logic.
function togglePlayPause() {
  if (anyPlaying()) {
    synth.stop();
    engine.pause();
  } else {
    engine.play();
    if (synthParts().length) synth.start(songTime, anyPlaying, synthParts);
  }
  updateTimecodes(); // flips the button label immediately, not up to 100ms later
}

// Natural end-of-song (not a manual pause/stop, which already call
// synth.stop() themselves) needs its own hook to cut the synth off too.
engine.onEnded = () => synth.stop();

function updateTimecodes() {
  const master = document.getElementById('master-time');
  if (!master) return;
  const duration = songDuration();
  const now = songTime();
  master.textContent = `${formatTimecode(now)} / ${formatTimecode(duration)}`;
  const fill = document.getElementById('master-bar-fill');
  if (fill) fill.style.width = duration ? `${(now / duration) * 100}%` : '0%';
  for (const t of Object.values(tracks)) {
    // Every stem shows the SAME `now` — the whole point of the shared clock
    // is that there's no longer a per-stem position to disagree about.
    if (t.timeEl) t.timeEl.textContent = formatTimecode(now);
    if (t.roll) t.roll.setPlayheadFraction(duration ? now / duration : 0);
    t.wavesurfer.setTime(now); // keeps the (muted, silent) waveform cursor visually in sync
  }
  // Runs on every tick (not just on click/spacebar), so the button stays
  // correct no matter what changed the play state — Stop all, the song
  // ending naturally, or anything else.
  const playPauseBtn = document.getElementById('play-pause-all');
  if (playPauseBtn) {
    const playing = anyPlaying();
    playPauseBtn.textContent = playing ? 'Pause all' : 'Play all';
    playPauseBtn.classList.toggle('is-playing', playing);
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
    return;
  }

  // Spacebar play/pause, so you can keep your eye on a waveform instead of
  // hunting for the right button — except while actually typing or while a
  // button has focus (there, Space should do its normal job: insert a
  // space, or activate that focused button — which fires this same toggle
  // anyway if it's the play/pause button itself, so it's never skipped).
  if (e.code === 'Space' || e.key === ' ') {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    if (!Object.keys(tracks).length) return; // nothing loaded yet
    e.preventDefault();
    togglePlayPause();
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
    <dt>Original file</dt><dd><a href="${upload.original_url}" download>Download</a>${
      upload.video_url ? ` · <a href="${upload.video_url}" download>Download original video</a>` : ''
    }</dd>
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
      <button id="play-pause-all">Play all</button>
      <button id="stop-all">Stop all</button>
      <span class="time-readout" id="master-time">0:00.00 / 0:00.00</span>
    </div>
    <div class="master-bar-row" id="master-bar"><div class="master-bar-fill" id="master-bar-fill"></div></div>
  `;
  playerDiv.appendChild(transport);
  transport.querySelector('#play-pause-all').onclick = togglePlayPause;
  transport.querySelector('#stop-all').onclick = () => {
    synth.stop();
    engine.stop();
    updateTimecodes();
  };
  transport.querySelector('#master-bar').onclick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekAll(((e.clientX - rect.left) / rect.width) * songDuration());
  };
  const engineLoads = [];

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
    muteBtn.className = 'toggle-btn mute-btn';
    const soloBtn = document.createElement('button');
    soloBtn.textContent = 'Solo';
    soloBtn.className = 'toggle-btn solo-btn';
    const volume = document.createElement('input');
    Object.assign(volume, { type: 'range', min: 0, max: 1, step: 0.01, value: 1 });
    controls.append(label, timeEl, muteBtn, soloBtn, volume);

    let synthBtn = null;
    if (midi) {
      synthBtn = document.createElement('button');
      synthBtn.textContent = 'Synth';
      synthBtn.className = 'toggle-btn synth-btn';
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

    // WaveSurfer draws the waveform and handles click-to-seek, but never
    // produces sound itself — muted permanently, since real playback goes
    // through `engine` now (see audioengine.js for why).
    const wavesurfer = WaveSurfer.create({ container: waveformDiv, height: 60, url });
    wavesurfer.setVolume(0);
    const t = tracks[stemName] = {
      wavesurfer, muted: false, soloed: false, volume: 1, notes: null, lastSaved: null, dirty: false,
      synthOn: false, isDrum, roll: null, timeEl, trackEl: track, rollGrid: null,
    };
    const engineLoad = engine.loadStem(stemName, url);
    engineLoads.push(engineLoad);

    // Clicking one waveform used to move only that stem, putting the others out of sync.
    wavesurfer.on('interaction', (time) => seekAll(time));

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
      saveBtn.disabled = true; // nothing to save until notes are loaded and edited
      const revertBtn = document.createElement('button');
      revertBtn.textContent = 'Revert';
      revertBtn.disabled = true;
      const zoomInBtn = document.createElement('button');
      zoomInBtn.textContent = '🔍+';
      zoomInBtn.title = 'Zoom in on this piano roll';
      const zoomOutBtn = document.createElement('button');
      zoomOutBtn.textContent = '🔍−';
      zoomOutBtn.title = 'Zoom out on this piano roll';
      zoomOutBtn.disabled = true; // starts at zoom=1, already fully zoomed out
      side.append(saveBtn, revertBtn, zoomInBtn, zoomOutBtn);

      const roll = createPianoRoll(rollContainer, {
        getDuration: () => engine.duration,
        isDrum,
        onChange: (notes) => {
          t.notes = notes;       // live, so Synth hears edits immediately — no server round trip needed
          t.dirty = true;
          lastEditedRoll = roll;
          updateCaption();
        },
      });
      t.roll = roll;
      t.rollGrid = rollContainer.querySelector('.roll-grid');

      function updateCaption() {
        const base = describeNotes(stemName, t.notes || [], midi.method);
        caption.textContent = t.dirty ? `${base} · unsaved changes (Save to keep, Revert to discard)` : `${base} · saved`;
        caption.classList.toggle('dirty', t.dirty);
        // Grey out Save/Revert with nothing to act on; highlight them the
        // moment there's an edit sitting unsaved, so it's obvious at a
        // glance whether this stem's roll has pending changes.
        saveBtn.disabled = !t.dirty;
        revertBtn.disabled = !t.dirty;
        saveBtn.classList.toggle('highlight', t.dirty);
        revertBtn.classList.toggle('highlight', t.dirty);
      }

      function updateZoomButtons() {
        const { atMin, atMax } = roll.zoomState();
        zoomOutBtn.disabled = atMin;
        zoomInBtn.disabled = atMax;
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
      zoomInBtn.onclick = () => { roll.zoomIn(); updateZoomButtons(); };
      zoomOutBtn.onclick = () => { roll.zoomOut(); updateZoomButtons(); };

      Promise.all([
        fetch(midi.notes_url).then((r) => r.json()),
        new Promise((resolve) => wavesurfer.once('ready', resolve)),
        engineLoad,
      ]).then(([{ notes }]) => {
        t.notes = notes;
        t.lastSaved = notes.map((n) => n.slice());
        roll.setNotes(notes);
        updateCaption();
        updateZoomButtons();
      });

      synthBtn.onclick = () => {
        t.synthOn = !t.synthOn;
        synthBtn.classList.toggle('active', t.synthOn);
        restartSynthIfPlaying();
      };
    } else if (upload.untranscribable.includes(stemName) && upload.transcribe_status === 'done') {
      const caption = document.createElement('div');
      caption.className = 'caption';
      caption.textContent = 'No MIDI for this stem.';
      main.appendChild(caption);
    }

    playerDiv.appendChild(track);
    if (t.rollGrid) alignRollKeys(t);

    muteBtn.onclick = () => {
      t.muted = !t.muted;
      muteBtn.classList.toggle('active', t.muted);
      engine.setMuted(stemName, t.muted);
    };
    soloBtn.onclick = () => {
      t.soloed = !t.soloed;
      soloBtn.classList.toggle('active', t.soloed);
      engine.setSoloed(stemName, t.soloed);
    };
    volume.oninput = () => {
      t.volume = parseFloat(volume.value);
      engine.setVolume(stemName, t.volume);
    };
  }

  alignMasterBar();

  const transportButtons = transport.querySelectorAll('button');
  transportButtons.forEach((b) => { b.disabled = true; });
  transport.querySelector('.time-readout').textContent = 'Loading audio engine…';
  Promise.all(engineLoads).then(() => {
    transportButtons.forEach((b) => { b.disabled = false; });
    updateTimecodes();
    masterTickTimer = setInterval(updateTimecodes, 100);
  });
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

// Same idea as alignMasterBar() above, applied to a stem's piano roll: the
// key-label column reuses the Save/Revert/zoom button column's actual
// rendered width (plus the row's own gap) instead of a fixed guess, and the
// whole roll is pulled left by exactly that much and widened to match — so
// the roll's note content still starts at the same x as the waveform above
// it (lining up every playhead), while the key labels end up sitting under
// those buttons instead of needing a second reserved gutter of their own.
function alignRollKeys(t) {
  const side = t.trackEl.querySelector('.track-side');
  const waveform = t.trackEl.querySelector('.track-waveform');
  if (!side || !waveform || !t.rollGrid) return;
  // Measuring the real gap between the two rendered boxes (rather than
  // parsing .track's CSS `gap` and adding it to .track-side's own width)
  // avoids a stray 1px from subpixel flex-layout rounding — same reasoning
  // as alignMasterBar() above, which measures rendered rects instead of
  // re-deriving a position from CSS.
  const keysWidth = waveform.getBoundingClientRect().left - side.getBoundingClientRect().left;
  t.rollGrid.style.marginLeft = `-${keysWidth}px`;
  t.rollGrid.style.width = `calc(100% + ${keysWidth}px)`;
  t.rollGrid.style.setProperty('--keys-width', `${keysWidth}px`);
}

function describeNotes(stemName, notes, method) {
  const label = METHOD_LABEL[method] || method;
  if (stemName === 'drums') return `${notes.length} hits · ${label}`;
  const pitches = notes.map((n) => n[0]);
  return `${notes.length} notes · ${label}` +
    (notes.length ? ` · range ${noteName(Math.min(...pitches))}–${noteName(Math.max(...pitches))}` : '');
}


let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    Object.values(tracks).forEach((t) => {
      if (!t.roll) return;
      alignRollKeys(t); // button column's width can reflow at a new viewport width
      t.roll.redraw();
    });
    alignMasterBar();
  }, 150);
});

// Shared by the file-input form and whole-page drag-and-drop below, so
// there's one upload code path regardless of how the file arrived. The
// server tells us what it actually turned out to be (ffprobe, not the
// filename) — audio goes straight into the player, video needs its audio
// extracted first.
async function handleFileUpload(file) {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', body });
  if (!res.ok) {
    const problem = await res.json().catch(() => ({}));
    alert('Could not upload: ' + (problem.detail || res.statusText));
    return;
  }
  const result = await res.json();
  if (result.kind === 'video') {
    watchVideoExtraction(result.download_id, file.name);
  } else {
    await refreshList(result.id);
    await selectUpload(result.id);
  }
}

// Mirrors downloads.js's extracted-audio -> "Separate stems" step, just
// surfaced right here instead of sending the user to the Downloads page —
// extraction is quick, but committing to a full separation run is a
// deliberate second click either way, so it stays a button, not automatic.
function watchVideoExtraction(downloadId, filename) {
  stopTimers();
  teardownPlayer();
  showPlayer();
  playerDiv.innerHTML = `
    <div class="status-box" id="video-extract-box">
      <p><strong>${escapeHtml(filename)}</strong> is a video — extracting its audio first.</p>
      <p id="extract-status">Starting…</p>
    </div>`;
  const statusEl = document.getElementById('extract-status');

  const check = async () => {
    const d = await fetch(`/api/downloads/${downloadId}`).then((r) => r.json());
    if (d.status === 'error') {
      clearInterval(pollTimer);
      pollTimer = null;
      document.getElementById('video-extract-box').innerHTML =
        `<p><strong>${escapeHtml(filename)}</strong></p><p class="status-error">Couldn't extract audio: ${escapeHtml(d.error || 'unknown error')}</p>`;
      return;
    }
    if (d.status !== 'done') {
      statusEl.textContent = d.progress ? formatProgress(d.progress) : 'Extracting…';
      return;
    }
    clearInterval(pollTimer);
    pollTimer = null;
    const box = document.getElementById('video-extract-box');
    box.innerHTML = `<p><strong>${escapeHtml(filename)}</strong> — audio extracted (${formatBytes(d.file_size_bytes)}).</p>`;
    const btn = document.createElement('button');
    btn.textContent = 'Transcribe now';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Starting…';
      const res = await fetch(`/api/downloads/${downloadId}/separate`, { method: 'POST' });
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}));
        alert('Could not start separation: ' + (problem.detail || res.statusText));
        btn.disabled = false;
        btn.textContent = 'Transcribe now';
        return;
      }
      const { upload_id } = await res.json();
      await refreshList(upload_id);
      await selectUpload(upload_id);
    };
    box.appendChild(btn);
  };
  check();
  pollTimer = setInterval(check, 2000);
}

form.onsubmit = async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = '';
  await handleFileUpload(file);
};

// Whole-page drag-and-drop. dragenter/dragleave fire on every child element
// crossed while dragging, not just once on the page as a whole — a depth
// counter (instead of a bare boolean) is what keeps the overlay from
// flickering on and off as the drag passes over child elements.
const dropOverlay = document.getElementById('drop-overlay');
let dragDepth = 0;

function dragHasFiles(e) {
  return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
}

window.addEventListener('dragenter', (e) => {
  if (!dragHasFiles(e)) return;
  dragDepth++;
  dropOverlay.classList.add('active');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.remove('active');
});
window.addEventListener('dragover', (e) => {
  // Without preventDefault() here, the browser's default is to refuse the
  // drop and navigate to the file instead.
  if (dragHasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('active');
  if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]);
});

const initialId = new URLSearchParams(location.search).get('upload');
if (initialId) {
  selectUpload(Number(initialId));
} else {
  refreshList(null);
}
