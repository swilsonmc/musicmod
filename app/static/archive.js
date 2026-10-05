async function load() {
  const uploads = await fetch('/api/uploads').then((r) => r.json());
  const tbody = document.getElementById('archive-body');
  tbody.innerHTML = '';

  for (const u of uploads) {
    const durationMs = (u.started_at && u.finished_at) ? new Date(u.finished_at) - new Date(u.started_at) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${escapeHtml(u.original_filename)}</td>
      <td>${formatBytes(u.file_size_bytes)}</td>
      <td class="status-${u.status}">${u.status}${u.error ? ': ' + escapeHtml(u.error) : ''}${u.status === 'processing' && u.progress ? ' — ' + escapeHtml(u.progress) : ''}</td>
      <td>${formatTime(u.started_at)}</td>
      <td>${formatTime(u.finished_at)}</td>
      <td>${formatDuration(durationMs)}</td>
      <td>${u.status === 'done' || u.status === 'processing' ? `<a href="/?upload=${u.id}">view</a>` : ''}</td>
    `;
    tbody.appendChild(tr);
  }
}

load();
