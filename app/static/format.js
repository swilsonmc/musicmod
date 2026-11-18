function formatBytes(bytes) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString();
}

function formatTimecode(seconds) {
  if (seconds == null || !isFinite(seconds)) return '0:00.00';
  const m = Math.floor(seconds / 60);
  const s = (seconds - m * 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

function noteName(midiPitch) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // JS's % keeps the dividend's sign, so a negative pitch would otherwise
  // index the array with a negative number and silently return undefined.
  return names[((midiPitch % 12) + 12) % 12] + (Math.floor(midiPitch / 12) - 1);
}

// Parses the "{stage}/{total}|{pct}|{detail}" format main.py's
// _progress_text() packs into the progress/transcribe_progress columns.
// Messages that don't use it (e.g. "Queued", "Starting…", "Done") come back
// with stage: null so callers can fall back to showing them plain.
function parseProgress(raw) {
  if (!raw) return null;
  const m = /^(\d+)\/(\d+)\|(\d*)\|([\s\S]*)$/.exec(raw);
  if (!m) return { stage: null, total: null, pct: null, overallPct: null, detail: raw };
  const stage = Number(m[1]), total = Number(m[2]);
  const pct = m[3] === '' ? null : Number(m[3]);
  const overallPct = Math.round((((stage - 1) + (pct || 0) / 100) / total) * 100);
  return { stage, total, pct, overallPct, detail: m[4] };
}

// "Task 2 of 3 · 42% overall — Instrumental model (...): 68% (17/25 chunks, ...)"
// — same per-task detail text as before, just with the pipeline position
// and an overall-progress estimate prefixed onto it.
function formatProgress(raw) {
  const p = parseProgress(raw);
  if (!p) return '';
  if (p.stage == null) return p.detail;
  return `Task ${p.stage} of ${p.total} · ${p.overallPct}% overall — ${p.detail}`;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}
