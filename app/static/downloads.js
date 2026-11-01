const IN_FLIGHT = new Set(['pending', 'downloading', 'extracting']);
let pollTimer = null;

async function load() {
  const downloads = await fetch('/api/downloads').then((r) => r.json());
  const tbody = document.getElementById('downloads-body');
  tbody.innerHTML = '';

  let anyInFlight = false;
  for (const d of downloads) {
    if (IN_FLIGHT.has(d.status)) anyInFlight = true;
    const tr = document.createElement('tr');
    const statusText = d.status + (d.error ? ': ' + escapeHtml(d.error) : '') +
      (IN_FLIGHT.has(d.status) && d.progress ? ' — ' + escapeHtml(d.progress) : '');

    let actionsHtml = '';
    if (d.status === 'done' && !d.upload_id) {
      actionsHtml = `<button data-separate="${d.id}">Separate stems</button>`;
    } else if (d.upload_id) {
      actionsHtml = `<a href="/?upload=${d.upload_id}">view separation</a>`;
    }
    if (!IN_FLIGHT.has(d.status)) {
      actionsHtml += ` <button class="danger" data-delete="${d.id}">Delete</button>`;
    }

    tr.innerHTML = `
      <td>${d.id}</td>
      <td>${escapeHtml(d.title || d.url)}</td>
      <td class="status-${d.status}">${statusText}</td>
      <td>${formatBytes(d.file_size_bytes)}</td>
      <td>${formatTime(d.created_at)}</td>
      <td class="actions">${actionsHtml}</td>
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

document.getElementById('download-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('url-input');
  const url = input.value.trim();
  if (!url) return;
  const res = await fetch('/api/downloads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    alert('Could not start download: ' + (body.detail || res.statusText));
    return;
  }
  input.value = '';
  load();
});

document.getElementById('downloads-body').addEventListener('click', async (e) => {
  const separateId = e.target.dataset.separate;
  const deleteId = e.target.dataset.delete;

  if (separateId) {
    e.target.disabled = true;
    const res = await fetch(`/api/downloads/${separateId}/separate`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert('Could not start separation: ' + (body.detail || res.statusText));
      e.target.disabled = false;
      return;
    }
    load();
  }

  if (deleteId) {
    if (!confirm('Delete this download and its files?')) return;
    const res = await fetch(`/api/downloads/${deleteId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert('Could not delete: ' + (body.detail || res.statusText));
      return;
    }
    load();
  }
});

load();
