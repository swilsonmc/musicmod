// pending/processing uploads, and 'done' ones still transcribing, are the
// only rows that can change without a page reload — everything else (done
// and fully transcribed, or error) is settled and not worth re-polling for.
const IN_FLIGHT = new Set(['pending', 'processing']);
const TRANSCRIBE_IN_FLIGHT = new Set(['pending', 'processing']);
let pollTimer = null;

async function load() {
  const uploads = await fetch('/api/uploads').then((r) => r.json());
  const tbody = document.getElementById('archive-body');
  tbody.innerHTML = '';

  let anyInFlight = false;
  for (const u of uploads) {
    if (IN_FLIGHT.has(u.status) || TRANSCRIBE_IN_FLIGHT.has(u.transcribe_status)) anyInFlight = true;
    const durationMs = (u.started_at && u.finished_at) ? new Date(u.finished_at) - new Date(u.started_at) : null;
    let statusText = u.status + (u.error ? ': ' + escapeHtml(u.error) : '');
    if (IN_FLIGHT.has(u.status) && u.progress) {
      statusText += ' — ' + escapeHtml(formatProgress(u.progress));
    } else if (u.status === 'done' && TRANSCRIBE_IN_FLIGHT.has(u.transcribe_status)) {
      statusText += ' — transcribing' + (u.transcribe_progress ? ': ' + escapeHtml(formatProgress(u.transcribe_progress)) : '');
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${escapeHtml(u.original_filename)}</td>
      <td>${formatBytes(u.file_size_bytes)}</td>
      <td class="status-${u.status}">${statusText}</td>
      <td>${formatTime(u.started_at)}</td>
      <td>${formatTime(u.finished_at)}</td>
      <td>${formatDuration(durationMs)}</td>
      <td>${u.status === 'done' || u.status === 'processing' ? `<a href="/?upload=${u.id}">view</a>` : ''}</td>
    `;
    tbody.appendChild(tr);
  }

  if (anyInFlight && !pollTimer) {
    pollTimer = setInterval(load, 3000);
  } else if (!anyInFlight && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

load();
