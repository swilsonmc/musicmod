// Sample-accurate multitrack playback.
//
// WaveSurfer gives each stem its own <audio> element, and each <audio>
// element runs its own independent playback clock — fine for one track,
// but measured in testing to drift apart from other tracks that started
// in perfect sync (~1.4ms after 7.6s). This engine replaces WaveSurfer as
// the thing that actually produces sound: every stem is decoded once into
// an AudioBuffer, and all stems are started from AudioBufferSourceNodes
// scheduled against the exact same AudioContext clock in the same
// scheduling call, so they can't drift apart from each other — there is
// only one clock. WaveSurfer instances stay in use for drawing the
// waveform and click-to-seek, but are muted and never drive playback.
const engine = {
  ctx: null,
  stems: {},        // name -> { buffer, gain, source, muted, soloed, volume }
  startContextTime: 0,
  startOffset: 0,
  playing: false,
  duration: 0,
  onTick: null,      // (time) => void, called on every animation frame while playing
  onEnded: null,     // () => void, called only when playback reaches the end on its own

  ensureContext() {
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    return this.ctx;
  },

  async loadStem(name, url) {
    const ctx = this.ensureContext();
    const arrayBuffer = await fetch(url).then((r) => r.arrayBuffer());
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    this.stems[name] = { buffer, gain, source: null, muted: false, soloed: false, volume: 1 };
    this.duration = Math.max(this.duration, buffer.duration);
    return buffer.duration;
  },

  reset() {
    this._stopSources();
    this.stems = {};
    this.playing = false;
    this.startOffset = 0;
    this.duration = 0;
  },

  _applyMix() {
    const anySoloed = Object.values(this.stems).some((s) => s.soloed);
    for (const s of Object.values(this.stems)) {
      const audible = !s.muted && (!anySoloed || s.soloed);
      s.gain.gain.value = audible ? s.volume : 0;
    }
  },

  setMuted(name, muted) { if (this.stems[name]) { this.stems[name].muted = muted; this._applyMix(); } },
  setSoloed(name, soloed) { if (this.stems[name]) { this.stems[name].soloed = soloed; this._applyMix(); } },
  setVolume(name, volume) { if (this.stems[name]) { this.stems[name].volume = volume; this._applyMix(); } },

  currentTime() {
    if (!this.playing) return this.startOffset;
    return this.startOffset + (this.ctx.currentTime - this.startContextTime);
  },

  play() {
    if (this.playing || !Object.keys(this.stems).length) return;
    const ctx = this.ensureContext();
    ctx.resume();
    // Every stem's source node is created and .start()-ed with this same
    // `when` and the same offset, in the same synchronous pass below — that
    // shared scheduling call, against one clock, is what guarantees sync.
    const when = ctx.currentTime + 0.06;
    this.startContextTime = when;
    for (const s of Object.values(this.stems)) {
      const src = ctx.createBufferSource();
      src.buffer = s.buffer;
      src.connect(s.gain);
      src.start(when, Math.min(this.startOffset, s.buffer.duration));
      s.source = src;
    }
    this.playing = true;
    this._tick();
  },

  pause() {
    if (!this.playing) return;
    this.startOffset = this.currentTime();
    this._stopSources();
    this.playing = false;
  },

  stop() {
    this._stopSources();
    this.playing = false;
    this.startOffset = 0;
    if (this.onTick) this.onTick(0);
  },

  seek(time) {
    const wasPlaying = this.playing;
    this._stopSources();
    this.playing = false;
    this.startOffset = Math.max(0, Math.min(time, this.duration));
    if (wasPlaying) this.play();
    else if (this.onTick) this.onTick(this.startOffset);
  },

  _stopSources() {
    for (const s of Object.values(this.stems)) {
      if (s.source) { try { s.source.stop(); } catch (e) {} s.source.disconnect(); s.source = null; }
    }
  },

  _tick() {
    if (!this.playing) return;
    const t = this.currentTime();
    if (t >= this.duration) {
      this.stop();
      if (this.onEnded) this.onEnded();
      return;
    }
    if (this.onTick) this.onTick(t);
    requestAnimationFrame(() => this._tick());
  },
};
