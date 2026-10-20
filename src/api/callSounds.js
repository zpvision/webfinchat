// Keep one AudioContext unlocked by a user gesture for later incoming calls.
export class CallSounds {
  constructor({ onBlocked = () => {}, createContext = () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    return new AudioContext();
  } } = {}) {
    this.createContext = createContext;
    this.onBlocked = onBlocked;
    this.nodes = new Set();
    this.mode = null;
    this.disposed = false;
  }

  async unlock() {
    if (this.disposed) return;
    try {
      if (!this.context) {
        this.context = this.createContext();
        this.context.onstatechange = () => this.sync();
      }
      this.sync();
      if (this.context.state !== 'running') await this.context.resume();
      if (!this.disposed) this.sync();
    } catch {
      if (!this.disposed) this.onBlocked(Boolean(this.mode));
    }
  }

  setMode(mode) {
    if (this.mode === mode || this.disposed) return;
    this.stop();
    this.mode = mode;
    if (mode) this.unlock();
    else this.onBlocked(false);
  }

  sync() {
    if (this.disposed) return;
    const playable = this.context?.state === 'running';
    this.onBlocked(Boolean(this.mode && !playable));
    if (!this.mode || !playable) {
      this.stop();
      return;
    }
    if (this.timer) return;
    this.playPattern();
    this.timer = setInterval(() => this.playPattern(), this.mode === 'incoming' ? 4200 : 5000);
  }

  tone(frequency, offset, duration, volume) {
    const context = this.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + offset;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + .025);
    gain.gain.setValueAtTime(volume, start + duration * .55);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    this.nodes.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.nodes.delete(oscillator);
    };
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  }

  playPattern() {
    if (this.context?.state !== 'running' || !this.mode) return;
    if (this.mode === 'outgoing') {
      this.tone(425, 0, 1, .10);
    } else {
      // An original, gentle six-note ringtone, followed by a pause.
      [659.25, 830.61, 987.77, 659.25, 830.61, 1108.73].forEach((frequency, i) => {
        this.tone(frequency, [0, .22, .44, 1.05, 1.27, 1.49][i], .42, .09);
      });
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    for (const oscillator of this.nodes) {
      try { oscillator.stop(); } catch { /* The oscillator may have already ended. */ }
      oscillator.onended?.();
    }
    this.nodes.clear();
  }

  dispose() {
    this.disposed = true;
    this.mode = null;
    this.stop();
    if (this.context) {
      this.context.onstatechange = null;
      this.context.close().catch(() => {});
    }
  }
}
