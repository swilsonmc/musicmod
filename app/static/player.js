const uploadsList = document.getElementById('uploads');
const playerDiv = document.getElementById('player');
const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');

let tracks = {}; // stem_name -> { wavesurfer, muted, soloed, volume }
let pollTimer = null;
let tickTimer = null;

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
  if (pollTimer) clearInterval(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
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
    renderInProgress(upload);
    pollTimer = setInterval(() => selectUpload(id), 3000);
    return;
  }
  if (upload.status === 'error') {
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

function renderDone(upload) {
  playerDiv.innerHTML = '';
  tracks = {};

  const durationMs = (upload.started_at && upload.finished_at)
    ? new Date(upload.finished_at) - new Date(upload.started_at)
    : null;

  const summary = document.createElement('div');
  summary.className = 'status-box';
  summary.innerHTML = metaRow(upload, `
    <dt>Finished</dt><dd>${formatTime(upload.finished_at)}</dd>
    <dt>Took</dt><dd>${formatDuration(durationMs)}</dd>
  `);
  playerDiv.appendChild(summary);

  for (const [stemName, url] of Object.entries(upload.stems)) {
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
    volume.type = 'range';
    volume.min = 0;
    volume.max = 1;
    volume.step = 0.01;
    volume.value = 1;

    controls.append(label, muteBtn, soloBtn, volume);

    const waveformDiv = document.createElement('div');
    track.append(controls, waveformDiv);
    playerDiv.appendChild(track);

    const wavesurfer = WaveSurfer.create({
      container: waveformDiv,
      height: 60,
      url,
    });

    tracks[stemName] = { wavesurfer, muted: false, soloed: false, volume: 1 };

    muteBtn.onclick = () => {
      tracks[stemName].muted = !tracks[stemName].muted;
      muteBtn.style.fontWeight = tracks[stemName].muted ? 'bold' : 'normal';
      applyMix();
    };
    soloBtn.onclick = () => {
      tracks[stemName].soloed = !tracks[stemName].soloed;
      soloBtn.style.fontWeight = tracks[stemName].soloed ? 'bold' : 'normal';
      applyMix();
    };
    volume.oninput = () => {
      tracks[stemName].volume = parseFloat(volume.value);
      applyMix();
    };
  }

  const playAllBtn = document.createElement('button');
  playAllBtn.textContent = 'Play all';
  playAllBtn.onclick = () => Object.values(tracks).forEach((t) => t.wavesurfer.play());
  const stopAllBtn = document.createElement('button');
  stopAllBtn.textContent = 'Stop all';
  stopAllBtn.onclick = () => Object.values(tracks).forEach((t) => t.wavesurfer.stop());
  playerDiv.append(playAllBtn, stopAllBtn);
}

function applyMix() {
  const anySoloed = Object.values(tracks).some((t) => t.soloed);
  for (const t of Object.values(tracks)) {
    const audible = !t.muted && (!anySoloed || t.soloed);
    t.wavesurfer.setVolume(audible ? t.volume : 0);
  }
}

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
