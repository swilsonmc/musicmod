const uploadsList = document.getElementById('uploads');
const playerDiv = document.getElementById('player');
const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');

let tracks = {}; // stem_name -> { wavesurfer, muted, soloed, volume }
let pollTimer = null;

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

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function selectUpload(id) {
  stopPolling();
  const uploads = await refreshList(id);
  const upload = uploads.find((u) => u.id === id);
  if (!upload) return;

  if (upload.status === 'pending' || upload.status === 'processing') {
    playerDiv.innerHTML = '<p>Separating stems — this can take a few minutes on CPU…</p>';
    pollTimer = setInterval(() => selectUpload(id), 3000);
    return;
  }
  if (upload.status === 'error') {
    playerDiv.innerHTML = `<p class="status-error">Failed: ${upload.error}</p>`;
    return;
  }

  const detail = await fetch(`/api/uploads/${id}`).then((r) => r.json());
  buildPlayer(detail);
}

function buildPlayer(upload) {
  playerDiv.innerHTML = '';
  tracks = {};

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

    tracks[stemName] = { wavesurfer, muted: false, soloed: false };

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
    tracks[stemName].volume = 1;
  }

  const playAllBtn = document.createElement('button');
  playAllBtn.textContent = 'Play all';
  playAllBtn.onclick = () => Object.values(tracks).forEach((t) => t.wavesurfer.play());
  const stopAllBtn = document.createElement('button');
  stopAllBtn.textContent = 'Stop all';
  stopAllBtn.onclick = () => Object.values(tracks).forEach((t) => t.wavesurfer.stop());
  playerDiv.prepend(stopAllBtn);
  playerDiv.prepend(playAllBtn);
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

refreshList(null);
