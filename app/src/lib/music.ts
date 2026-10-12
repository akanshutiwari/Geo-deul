// "Hunt" soundtrack, synthesized live with Web Audio — no audio files.
// A minor-key exploration loop: soft pad, plucked arpeggio with echo, bass,
// shaker and kick. Intensity (0..1) speeds it up and adds hats near the end.

const NOTE = (n: number) => 440 * 2 ** ((n - 69) / 12);
// i – VI – III – VII in A minor (Am, F, C, G), as MIDI notes
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];
const ARP = [0, 1, 2, 1, 2, 0, 2, 1];
const MUTE_KEY = "geo-music-muted";

export const musicMuted = () => {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
};
export const setMusicMuted = (m: boolean) => {
  try {
    window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
};

class HuntMusic {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private delay!: DelayNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextAt = 0;
  private intensity = 0;
  private noise!: AudioBuffer;
  private unlock = () => this.ctx?.resume();

  start() {
    if (this.timer) return;
    if (!this.ctx) this.setup();
    const ctx = this.ctx!;
    ctx.resume().catch(() => {});
    // browsers only allow audio after a gesture: resume on the next one
    window.addEventListener("pointerdown", this.unlock);
    window.addEventListener("keydown", this.unlock);
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0.32, ctx.currentTime, 0.8);
    this.nextAt = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (!this.ctx || !this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
  }

  setIntensity(x: number) {
    this.intensity = Math.max(0, Math.min(1, x));
  }

  private setup() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    // echo bus for the plucks
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2200;
    this.delay.connect(tone).connect(fb).connect(this.delay);
    tone.connect(this.master);
    // noise for shaker / hats
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  private schedule() {
    const ctx = this.ctx!;
    const bpm = 92 + this.intensity * 36;
    const eighth = 60 / bpm / 2;
    while (this.nextAt < ctx.currentTime + 0.12) {
      this.tick(this.step, this.nextAt, eighth);
      this.nextAt += eighth;
      this.step = (this.step + 1) % 32;
    }
  }

  private tick(step: number, t: number, eighth: number) {
    const chord = CHORDS[Math.floor(step / 8)];
    const beat = step % 8;
    if (beat === 0) this.pad(chord, t, eighth * 8);
    if (beat === 0 || beat === 4) this.kick(t);
    if (beat === 0 || beat === 3 || beat === 4) this.bass(chord[0] - 12, t, eighth * 1.6);
    if (beat % 2 === 1) this.hiss(t, 0.05, 0.035, 6000);
    if (this.intensity > 0.6) this.hiss(t + eighth / 2, 0.03, 0.025, 9000);
    // the arp sits out every other bar at low intensity to stay airy
    if (this.intensity > 0.3 || Math.floor(step / 8) % 2 === 0 || beat % 2 === 0) {
      const octave = beat >= 4 ? 24 : 12;
      this.pluck(chord[ARP[beat]] + octave, t, eighth * 1.8);
    }
  }

  private pad(chord: number[], t: number, dur: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 700 + this.intensity * 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    f.connect(g).connect(this.master);
    for (const n of chord) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = NOTE(n);
        o.detune.value = detune;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  private pluck(n: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = NOTE(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private bass(n: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = NOTE(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }

  private hiss(t: number, dur: number, vol: number, hp: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.4, dur + 0.02);
  }
}

export const huntMusic = new HuntMusic();
