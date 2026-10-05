const uploadsList = document.getElementById('uploads');
const playerDiv = document.getElementById('player');
const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');

let tracks = {}; // stem_name -> { wavesurfer, muted, soloed, volume, notes, synthOn, redraw }
let pollTimer = null;
let tickTimer = null;
let transcribeTimer = null;

const METHOD_LABEL = { basic_pitch: 'Basic Pitch (polyphonic)', pyin: 'pYIN (single melody line)' };

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
  for (const t of [pollTimer, tickTimer, transcribeTimer]) if (t) clearInterval(t);
  pollTimer = tickTimer = transcribeTimer = null;
}

// Without this, switching uploads leaves the previous song's audio playing invisibly.
function teardownPlayer() {
  synth.stop();
  for (const t of Object.values(tracks)) t.wavesurfer.destroy();
  tracks = {};
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
    text = 'Not transcribed to MIDI yet. Takes about a minute; drums aren\'t supported yet.';
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

function songTime() {
  const first = Object.values(tracks)[0];
  return first ? first.wavesurfer.getCurrentTime() : 0;
}

function anyPlaying() {
  return Object.values(tracks).some((t) => t.wavesurfer.isPlaying());
}

function synthParts() {
  return Object.values(tracks).filter((t) => t.synthOn && t.notes).map((t) => ({ notes: t.notes, volume: t.volume }));
}

function restartSynthIfPlaying() {
  synth.stop();
  if (anyPlaying() && synthParts().length) synth.start(songTime, anyPlaying, synthParts);
}

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

  const transport = document.createElement('div');
  transport.className = 'transport';
  const playAllBtn = document.createElement('button');
  playAllBtn.textContent = 'Play all';
  playAllBtn.onclick = () => {
    Object.values(tracks).forEach((t) => t.wavesurfer.play());
    if (synthParts().length) synth.start(songTime, anyPlaying, synthParts);
  };
  const stopAllBtn = document.createElement('button');
  stopAllBtn.textContent = 'Stop all';
  stopAllBtn.onclick = () => {
    synth.stop();
    Object.values(tracks).forEach((t) => t.wavesurfer.stop());
  };
  transport.append(playAllBtn, stopAllBtn);
  playerDiv.appendChild(transport);

  for (const [stemName, url] of Object.entries(upload.stems)) {
    const midi = upload.midi[stemName];
    const track = document.createElement('div');
    track.className = 'track';

    const controls = document.createElement('div');
    controls.className = 'track-controls';
    const label = document.createElement('span');
    label.textContent = stemName;
    const muteBtn = document.createElement('button');
    muteBtn.textContent = 'Mute';
    const soloBtn = document.createElement('button');
    soloBtn.textContent = 'Solo';
    const volume = document.createElement('input');
    Object.assign(volume, { type: 'range', min: 0, max: 1, step: 0.01, value: 1 });
    controls.append(label, muteBtn, soloBtn, volume);

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
    track.append(controls, waveformDiv);
    playerDiv.appendChild(track);

    const wavesurfer = WaveSurfer.create({ container: waveformDiv, height: 60, url });
    const t = tracks[stemName] = { wavesurfer, muted: false, soloed: false, volume: 1, notes: null, synthOn: false, redraw: null };

    // Clicking one waveform used to move only that stem, putting the others out of sync.
    wavesurfer.on('interaction', (time) => {
      for (const other of Object.values(tracks)) {
        if (other !== t) other.wavesurfer.setTime(time);
      }
      restartSynthIfPlaying();
    });
    wavesurfer.on('finish', () => { if (!anyPlaying()) synth.stop(); });

    if (midi) {
      const rollWrap = document.createElement('div');
      rollWrap.className = 'roll';
      const canvas = document.createElement('canvas');
      const playhead = document.createElement('div');
      playhead.className = 'playhead';
      rollWrap.append(canvas, playhead);
      const caption = document.createElement('div');
      caption.className = 'caption';
      caption.textContent = `${midi.note_count} notes · ${METHOD_LABEL[midi.method] || midi.method} · loading…`;
      track.append(rollWrap, caption);

      Promise.all([
        fetch(midi.notes_url).then((r) => r.json()),
        new Promise((resolve) => wavesurfer.once('ready', resolve)),
      ]).then(([{ notes }]) => {
        t.notes = notes;
        t.redraw = () => drawRoll(canvas, notes, wavesurfer.getDuration());
        t.redraw();
        const pitches = notes.map((n) => n[0]);
        caption.textContent = `${notes.length} notes · ${METHOD_LABEL[midi.method] || midi.method}` +
          (notes.length ? ` · range ${noteName(Math.min(...pitches))}–${noteName(Math.max(...pitches))}` : '');
      });

      wavesurfer.on('timeupdate', (time) => {
        const d = wavesurfer.getDuration();
        if (d) playhead.style.left = `${(time / d) * 100}%`;
      });
      canvas.onclick = (e) => {
        const d = wavesurfer.getDuration();
        const time = (e.offsetX / canvas.clientWidth) * d;
        Object.values(tracks).forEach((o) => o.wavesurfer.setTime(time));
        restartSynthIfPlaying();
      };
      synthBtn.onclick = () => {
        t.synthOn = !t.synthOn;
        synthBtn.style.fontWeight = t.synthOn ? 'bold' : 'normal';
        restartSynthIfPlaying();
      };
    } else if (upload.untranscribable.includes(stemName) && upload.transcribe_status === 'done') {
      const caption = document.createElement('div');
      caption.className = 'caption';
      caption.textContent = 'No MIDI — drums need a dedicated drum transcriber, which isn\'t built yet.';
      track.appendChild(caption);
    }

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
  resizeTimer = setTimeout(() => Object.values(tracks).forEach((t) => t.redraw && t.redraw()), 150);
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
