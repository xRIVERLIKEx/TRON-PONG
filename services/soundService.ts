
class SoundService {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sidechainGain: GainNode | null = null; // Used for "pumping" effect
  private isMusicPlaying = false;
  private nextNoteTime = 0;
  private currentStep = 0;
  private timerId: number | null = null;
  private bpm = 122;
  private totalSteps = 0;

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Master output
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      
      // Music branch with sidechain compression effect
      this.sidechainGain = this.ctx.createGain();
      this.sidechainGain.connect(this.masterGain);
      
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.4;
      this.musicGain.connect(this.sidechainGain);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Helper for FM synthesis / complex tones
  private playFMSynth(freq: number, time: number, duration: number, modIndex: number = 10, modFreqRatio: number = 2) {
    if (!this.ctx || !this.musicGain) return;
    
    const carrier = this.ctx.createOscillator();
    const modulator = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const env = this.ctx.createGain();

    carrier.type = 'sine';
    modulator.type = 'sine';

    carrier.frequency.setValueAtTime(freq, time);
    modulator.frequency.setValueAtTime(freq * modFreqRatio, time);
    
    modGain.gain.setValueAtTime(freq * modIndex, time);
    modGain.gain.exponentialRampToValueAtTime(0.01, time + duration);

    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.1, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(env);
    env.connect(this.musicGain);

    modulator.start(time);
    carrier.start(time);
    modulator.stop(time + duration);
    carrier.stop(time + duration);
  }

  private scheduleNote(step: number, time: number) {
    if (!this.ctx || !this.musicGain || !this.sidechainGain) return;

    const isChorus = (Math.floor(this.totalSteps / 64) % 4) >= 2;

    // 1. KICK - Triggers the Sidechain Pump
    if (step % 8 === 0) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(40, time + 0.2);
      g.gain.setValueAtTime(0.6, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
      osc.connect(g);
      g.connect(this.masterGain!); // Kicks don't get sidechained by themselves
      osc.start(time);
      osc.stop(time + 0.4);

      // --- SIDECHAIN PUMP ---
      // Quickly dip the music volume when the kick hits
      this.sidechainGain.gain.cancelScheduledValues(time);
      this.sidechainGain.gain.setValueAtTime(1.0, time);
      this.sidechainGain.gain.linearRampToValueAtTime(0.2, time + 0.05); // Dip
      this.sidechainGain.gain.exponentialRampToValueAtTime(1.0, time + 0.25); // Recover
    }

    // 2. SNARE - With Reverb-like tail
    if (step % 16 === 8) {
      this.playSynthwaveTone(200, 0.1, 0.15, 'triangle');
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.createNoiseBuffer();
      const nG = this.ctx.createGain();
      const nF = this.ctx.createBiquadFilter();
      nF.type = 'bandpass';
      nF.frequency.setValueAtTime(1200, time);
      nG.gain.setValueAtTime(0.2, time);
      nG.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
      noise.connect(nF);
      nF.connect(nG);
      nG.connect(this.musicGain);
      noise.start(time);
    }

    // 3. HI-HATS - Driving 16th notes with variation
    const hatVolume = (step % 4 === 0) ? 0.04 : 0.02;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer();
    const nG = this.ctx.createGain();
    const nF = this.ctx.createBiquadFilter();
    nF.type = 'highpass';
    nF.frequency.setValueAtTime(8000, time);
    nG.gain.setValueAtTime(hatVolume, time);
    nG.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    noise.connect(nF);
    nF.connect(nG);
    nG.connect(this.musicGain);
    noise.start(time);

    // 4. BASSLINE - Syncopated D-F-G-C Progression
    const progressions = [
      [73.42, 73.42, 73.42, 73.42], // D1
      [87.31, 87.31, 87.31, 87.31], // F1
      [98.00, 98.00, 98.00, 98.00], // G1
      [65.41, 65.41, 65.41, 65.41]  // C1
    ];
    const currentProg = progressions[Math.floor(this.totalSteps / 16) % progressions.length];
    const bassFreq = currentProg[Math.floor(step / 4) % 4];
    
    // Play on 1, 3, 4, 6, 7 (Syncopated)
    const isBassStep = [0, 2, 3, 5, 6].includes(step % 8);
    if (isBassStep) {
      const bOsc = this.ctx.createOscillator();
      const bG = this.ctx.createGain();
      const bF = this.ctx.createBiquadFilter();
      bOsc.type = 'sawtooth';
      bOsc.frequency.setValueAtTime(bassFreq, time);
      bF.type = 'lowpass';
      bF.frequency.setValueAtTime(400, time);
      bG.gain.setValueAtTime(0.15, time);
      bG.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
      bOsc.connect(bF);
      bF.connect(bG);
      bG.connect(this.musicGain);
      bOsc.start(time);
      bOsc.stop(time + 0.15);
    }

    // 5. LEAD MELODY - FM Synthesis
    if (isChorus) {
      const melody = [293.66, 0, 349.23, 0, 392.00, 440.00, 349.23, 0]; // D4, F4, G4, A4
      const note = melody[step % 8];
      if (note > 0) {
        this.playFMSynth(note, time, 0.4, 8, 2.01);
      }
    } else {
      // Verse Arp
      const scale = [293.66, 349.23, 392.00, 440.00];
      if (step % 2 === 0) {
        const note = scale[(step / 2) % scale.length];
        this.playFMSynth(note, time, 0.15, 2, 4);
      }
    }
  }

  private scheduler() {
    if (!this.ctx || !this.isMusicPlaying) return;
    while (this.nextNoteTime < this.ctx.currentTime + 0.1) {
      this.scheduleNote(this.currentStep, this.nextNoteTime);
      const secondsPerStep = 60.0 / this.bpm / 4;
      this.nextNoteTime += secondsPerStep;
      this.currentStep = (this.currentStep + 1) % 32;
      this.totalSteps++;
      
      // Notify components of beat for visual pulsing
      if (this.currentStep % 8 === 0) {
        window.dispatchEvent(new CustomEvent('grid-pulse', { detail: { step: this.currentStep } }));
      }
    }
    this.timerId = window.setTimeout(() => this.scheduler(), 25);
  }

  public startMusic() {
    this.init();
    if (this.isMusicPlaying) return;
    this.isMusicPlaying = true;
    this.nextNoteTime = this.ctx!.currentTime;
    this.totalSteps = 0;
    this.currentStep = 0;
    this.scheduler();
  }

  public stopMusic() {
    this.isMusicPlaying = false;
    if (this.timerId) clearTimeout(this.timerId);
  }

  public toggleMusic() {
    if (this.isMusicPlaying) this.stopMusic();
    else this.startMusic();
    return this.isMusicPlaying;
  }

  private createNoiseBuffer() {
    if (!this.ctx) return null;
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private playSynthwaveTone(freq: number, duration: number, volume: number = 0.1, type: OscillatorType = 'sawtooth') {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 2, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(now + duration);
  }

  public playPaddleHit() {
    this.init();
    if (!this.ctx) return;
    this.playSynthwaveTone(660, 0.15, 0.1, 'square');
  }

  public playWallHit() {
    this.init();
    if (!this.ctx) return;
    this.playSynthwaveTone(150, 0.2, 0.1, 'sine');
  }

  public playExplosion() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const rumble = this.ctx.createOscillator();
    const rumbleGain = this.ctx.createGain();
    rumble.type = 'square';
    rumble.frequency.setValueAtTime(100, now);
    rumble.frequency.exponentialRampToValueAtTime(20, now + 0.5);
    rumbleGain.gain.setValueAtTime(0.3, now);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    rumble.connect(rumbleGain);
    rumbleGain.connect(this.ctx.destination);
    rumble.start();
    rumble.stop(now + 0.5);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer();
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.3, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    noise.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    noise.start();
  }

  public playScore() {
    this.init();
    if (!this.ctx) return;
    this.playSynthwaveTone(800, 0.8, 0.2, 'sawtooth');
  }

  public playPowerUp() {
    this.init();
    if (!this.ctx) return;
    [440, 660, 880].forEach((f, i) => {
      setTimeout(() => this.playSynthwaveTone(f, 0.3, 0.05, 'square'), i * 100);
    });
  }

  public playLevelStart() {
    this.init();
    if (!this.ctx) return;
    this.playSynthwaveTone(220, 1.5, 0.1, 'sawtooth');
  }
}

export const soundService = new SoundService();
