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
  return names[midiPitch % 12] + (Math.floor(midiPitch / 12) - 1);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s ?? '';
  return div.innerHTML;
}
