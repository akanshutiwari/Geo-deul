// "Expedition" soundtrack, synthesized live with Web Audio — no audio files.
//
// A warm A-minor exploration groove (Am9 – Fmaj7 – Cadd9 – G6) at ~100 bpm:
//  • soft analog-style pad, low-passed and breathing
//  • FM marimba playing a syncopated arpeggio
//  • an ocarina-like lead singing a pentatonic theme every other bar
//  • round sub bass, gentle kick, shaker, and a woodblock "clock tick"
// Everything runs through a generated hall reverb. Intensity (0..1) pushes the
// tempo, opens the filters and doubles the ticks for the last seconds.

const NOTE = (n: number) => 440 * 2 ** ((n - 69) / 12);

interface Chord {
  bass: number;
  pad: number[];
  arp: number[];
}
const CHORDS: Chord[] = [
  { bass: 45, pad: [57, 60, 64, 67, 71], arp: [69, 72, 76, 79, 83] }, // Am9
  { bass: 41, pad: [53, 57, 60, 64], arp: [65, 69, 72, 76, 77] }, // Fmaj7
  { bass: 48, pad: [55, 60, 62, 64], arp: [67, 72, 74, 76, 79] }, // Cadd9
  { bass: 43, pad: [55, 59, 62, 64], arp: [67, 71, 74, 76, 79] }, // G6
];
// syncopated 16th-note arpeggio: index into chord.arp, -1 = rest
const ARP = [0, -1, 2, 1, -1, 3, 2, -1, 4, -1, 3, 2, -1, 1, 2, -1];
// lead phrases (step-in-bar, midi, length in 16ths) — A minor pentatonic
const THEME_A: [number, number, number][] = [
  [0, 76, 3], [3, 79, 1], [4, 81, 4], [8, 79, 2], [10, 76, 2], [12, 74, 4],
];
const THEME_B: [number, number, number][] = [
  [0, 72, 2], [2, 74, 2], [4, 76, 6], [10, 79, 2], [12, 76, 2], [14, 74, 2],
];
const THEME_C: [number, number, number][] = [
  [0, 81, 2], [2, 79, 2], [4, 76, 4], [8, 74, 2], [10, 72, 2], [12, 69, 4],
];

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

class Expedition {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private verb!: GainNode;
  private noise!: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private bar = 0;
  private nextAt = 0;
  private intensity = 0;
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
    this.master.gain.setValueAtTime(this.master.gain.value, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 2.5);
    this.step = 0;
    this.bar = 0;
    this.nextAt = ctx.currentTime + 0.15;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (!this.ctx || !this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0, t + 0.8);
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
  }

  setIntensity(x: number) {
    this.intensity = Math.max(0, Math.min(1, x));
  }

  // ───────────── graph ─────────────

  private setup() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.85;
    this.dry.connect(this.master);

    // hall reverb from a decaying stereo noise impulse
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
    }
    conv.buffer = ir;
    const verbTone = ctx.createBiquadFilter();
    verbTone.type = "lowpass";
    verbTone.frequency.value = 4500;
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.5;
    this.verb.connect(conv).connect(verbTone).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  /** route a voice to dry + reverb with the given send */
  private out(node: AudioNode, send: number) {
    node.connect(this.dry);
    if (send > 0) {
      const s = this.ctx!.createGain();
      s.gain.value = send;
      node.connect(s).connect(this.verb);
    }
  }

  // ───────────── sequencer ─────────────

  private schedule() {
    const ctx = this.ctx!;
    const bpm = 100 + this.intensity * 18;
    const sixteenth = 60 / bpm / 4;
    while (this.nextAt < ctx.currentTime + 0.15) {
      this.tick(this.nextAt, sixteenth);
      this.nextAt += sixteenth;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  private tick(t: number, s16: number) {
    const chord = CHORDS[this.bar % 4];
    const st = this.step;
    const hot = this.intensity;

    if (st === 0) this.pad(chord.pad, t, s16 * 16);
    if (st === 0) this.bass(chord.bass, t, s16 * 5);
    if (st === 6) this.bass(chord.bass + 7, t, s16 * 2);
    if (st === 10) this.bass(chord.bass + 12, t, s16 * 2);

    const a = ARP[st];
    if (a >= 0) this.marimba(chord.arp[a] + (this.bar % 8 >= 4 && st >= 8 ? 12 : 0), t, st % 4 === 0 ? 0.16 : 0.11);

    // the lead sings on bars 2 & 4 of each phrase, cycling through themes
    if (this.bar % 2 === 1) {
      const theme = [THEME_A, THEME_B, THEME_A, THEME_C][Math.floor(this.bar / 2) % 4];
      for (const [at, n, l] of theme) if (at === st) this.ocarina(n, t, l * s16);
    }

    if (st === 0 || st === 8 || (hot > 0.5 && st === 12)) this.kick(t);
    if (st % 2 === 1) this.shaker(t, 0.018 + hot * 0.02);
    if (st === 4 || st === 12 || (hot > 0.3 && st % 2 === 0)) this.woodblock(t, hot > 0.3 && st % 4 !== 0 ? 0.05 : 0.09);
  }

  // ───────────── instruments ─────────────

  private pad(notes: number[], t: number, dur: number) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.4;
    f.frequency.setValueAtTime(500 + this.intensity * 600, t);
    f.frequency.linearRampToValueAtTime(1100 + this.intensity * 900, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 1.2);
    g.gain.setValueAtTime(0.045, t + dur - 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.8);
    f.connect(g);
    this.out(g, 0.9);
    for (const n of notes) {
      for (const [type, det, lvl] of [["triangle", -5, 1], ["sine", 5, 0.8]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = NOTE(n);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = lvl;
        o.connect(og).connect(f);
        o.start(t);
        o.stop(t + dur + 1);
      }
    }
  }

  /** two-operator FM mallet */
  private marimba(n: number, t: number, vol: number) {
    const ctx = this.ctx!;
    const f = NOTE(n);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 4;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 2.2, t);
    idx.gain.exponentialRampToValueAtTime(1, t + 0.12);
    mod.connect(idx).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.sin(n * 1.7) * 0.45;
    car.connect(g).connect(pan);
    this.out(pan, 0.35);
    car.start(t);
    mod.start(t);
    car.stop(t + 1);
    mod.stop(t + 1);
  }

  /** breathy sine lead with delayed vibrato */
  private ocarina(n: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = NOTE(n);
    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = NOTE(n) * 2;
    const o2g = ctx.createGain();
    o2g.gain.value = 0.12;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(NOTE(n) * 0.006, t + Math.min(0.35, dur));
    lfo.connect(depth).connect(o.frequency);
    const breath = ctx.createBufferSource();
    breath.buffer = this.noise;
    const bf = ctx.createBiquadFilter();
    bf.type = "bandpass";
    bf.frequency.value = NOTE(n) * 2;
    bf.Q.value = 6;
    const bg = ctx.createGain();
    bg.gain.value = 0.05;
    const g = ctx.createGain();
    const end = t + dur;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085, t + 0.06);
    g.gain.setValueAtTime(0.08, Math.max(t + 0.07, end - 0.08));
    g.gain.linearRampToValueAtTime(0.0001, end + 0.25);
    o.connect(g);
    o2.connect(o2g).connect(g);
    breath.connect(bf).connect(bg).connect(g);
    this.out(g, 0.7);
    for (const x of [o, o2, lfo]) {
      x.start(t);
      x.stop(end + 0.3);
    }
    breath.start(t, Math.random() * 0.5, dur + 0.3);
  }

  private bass(n: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = NOTE(n);
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = NOTE(n);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    sub.connect(f);
    f.connect(g);
    this.out(g, 0.05);
    for (const x of [o, sub]) {
      x.start(t);
      x.stop(t + dur + 0.05);
    }
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g);
    this.out(g, 0.04);
    o.start(t);
    o.stop(t + 0.3);
  }

  private shaker(t: number, vol: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 7500;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    const pan = ctx.createStereoPanner();
    pan.pan.value = 0.3;
    src.connect(f).connect(g).connect(pan);
    this.out(pan, 0.15);
    src.start(t, Math.random() * 0.8, 0.09);
  }

  /** hollow wooden "clock tick" — the ticking of the hunt */
  private woodblock(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(1250, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1100;
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.35;
    o.connect(f).connect(g).connect(pan);
    this.out(pan, 0.25);
    o.start(t);
    o.stop(t + 0.1);
  }
}

export const huntMusic = new Expedition();
