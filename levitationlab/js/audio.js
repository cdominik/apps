/**
 * @file audio.js
 * @description
 *   Web Audio API engine: motor hum, impact sounds, chimes, and the mill
 *   sequence. Also wires the pointerdown/keydown listeners that resume
 *   the AudioContext after a user gesture.
 *
 * Exposes globals: AUDIO, initAudio, updateMotorSound, ensureAudio,
 *                  soundTink, soundSnap, soundCrunch, soundChime,
 *                  soundMillStart, soundMillStop,
 *                  soundGoldenChime, soundGoldenThud
 * Reads globals:   TUNING, state
 */
(() => {
  'use strict';

  // ============================================================
  // SECTION: AUDIO
  // ============================================================
  const AUDIO = { ctx: null, master: null, motor: {}, enabled: true };
  /**
   * Initialises the AudioContext, master gain, motor oscillators, and noise source.
   */
  function initAudio() {
    if (AUDIO.ctx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      AUDIO.ctx = new Ctx();
      AUDIO.master = AUDIO.ctx.createGain();
      AUDIO.master.gain.value = AUDIO.enabled ? TUNING.audio.masterGain : 0.0;
      AUDIO.master.connect(AUDIO.ctx.destination);
      const a = AUDIO.ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 60;
      const b = AUDIO.ctx.createOscillator(); b.type = 'sawtooth'; b.frequency.value = 60 * 1.01;
      const sum = AUDIO.ctx.createGain(); sum.gain.value = 0;
      const lp = AUDIO.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 0.7;
      a.connect(sum); b.connect(sum); sum.connect(lp); lp.connect(AUDIO.master);
      const bufSize = 2 * AUDIO.ctx.sampleRate;
      const noiseBuf = AUDIO.ctx.createBuffer(1, bufSize, AUDIO.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = AUDIO.ctx.createBufferSource(); noise.buffer = noiseBuf; noise.loop = true;
      const noiseBP = AUDIO.ctx.createBiquadFilter(); noiseBP.type = 'bandpass'; noiseBP.frequency.value = 300; noiseBP.Q.value = 0.8;
      const noiseGain = AUDIO.ctx.createGain(); noiseGain.gain.value = 0;
      noise.connect(noiseBP); noiseBP.connect(noiseGain); noiseGain.connect(AUDIO.master);
      a.start(); b.start(); noise.start();
      AUDIO.motor = { oscA: a, oscB: b, noise, noiseFilter: noiseBP, gainOsc: sum, gainNoise: noiseGain, started: true };
    } catch (e) { AUDIO.ctx = null; }
  }
  /**
   * Called each frame; sets motor oscillator pitch and noise gain to match current drum speed.
   */
  function updateMotorSound() {
    if (!AUDIO.ctx || !AUDIO.motor.started) return;
    const absOm = Math.abs(state.omega);
    const pitchBase = 40 + Math.min(1, absOm / TUNING.drum.omegaMax) * 200;
    const targetOscGain = Math.min(0.35, absOm * 0.20);
    const targetNoiseGain = Math.min(0.12, absOm * 0.07);
    const t = AUDIO.ctx.currentTime;
    const TAU = 0.06;
    AUDIO.motor.oscA.frequency.setTargetAtTime(pitchBase, t, TAU);
    AUDIO.motor.oscB.frequency.setTargetAtTime(pitchBase * 1.01, t, TAU);
    AUDIO.motor.noiseFilter.frequency.setTargetAtTime(200 + pitchBase * 0.6, t, TAU);
    AUDIO.motor.gainOsc.gain.setTargetAtTime(targetOscGain, t, TAU);
    AUDIO.motor.gainNoise.gain.setTargetAtTime(targetNoiseGain, t, TAU);
  }
  let lastTinkTime = 0;
  const TINK_COOLDOWN = 0.5; // 50ms cooldown
  /**
   * Plays a short metallic tink (particle wall collision), with cooldown.
   */
  function soundTink() {
    if (!AUDIO.ctx) return;
    const now = AUDIO.ctx.currentTime;
    if (now - lastTinkTime < TINK_COOLDOWN) return; // Skip if too soon
    lastTinkTime = now;
    const t = now;
    const lp = AUDIO.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.18);
    lp.Q.value = 4;
    const g = AUDIO.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    const o1 = AUDIO.ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(220, t);
    o1.frequency.exponentialRampToValueAtTime(90, t + 0.16);
    const bufSize = Math.floor(AUDIO.ctx.sampleRate * 0.05);
    const noiseBuf = AUDIO.ctx.createBuffer(1, bufSize, AUDIO.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const n = AUDIO.ctx.createBufferSource(); n.buffer = noiseBuf;
    const nbp = AUDIO.ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 300; nbp.Q.value = 2;
    const ng = AUDIO.ctx.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o1.connect(g); g.connect(lp); lp.connect(AUDIO.master);
    n.connect(nbp); nbp.connect(ng); ng.connect(AUDIO.master);
    o1.start(t); o1.stop(t + 0.3);
    n.start(t); n.stop(t + 0.05);
  }
  let MILL_HANDLE = null;

  /**
   * Plays a rapid click sequence (aggregate formation).
   */
  function soundSnap() {
    if (!AUDIO.ctx) return;
    const t = AUDIO.ctx.currentTime;
    const numClicks = 9;
    const initialGap = 0.04;
    const acceleration = 0.85;
    let currentOffset = 0;
    let currentGap = initialGap;
    for (let i = 0; i < numClicks; i++) {
        const clickTime = t + currentOffset;
        const osc = AUDIO.ctx.createOscillator();
        const gain = AUDIO.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2500 + (i * 200), clickTime);
        osc.frequency.exponentialRampToValueAtTime(100, clickTime + 0.015);
        gain.gain.setValueAtTime(0, clickTime);
        gain.gain.linearRampToValueAtTime(0.6, clickTime + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.001, clickTime + 0.015);
        const noiseBuf = AUDIO.ctx.createBuffer(1, AUDIO.ctx.sampleRate * 0.02, AUDIO.ctx.sampleRate);
        const noiseData = noiseBuf.getChannelData(0);
        for(let j=0; j<noiseData.length; j++) noiseData[j] = Math.random() * 2 - 1;
        const noiseSource = AUDIO.ctx.createBufferSource();
        noiseSource.buffer = noiseBuf;
        const noiseGain = AUDIO.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.3, clickTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, clickTime + 0.01);
        const filter = AUDIO.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 3000;
        filter.Q.value = 1;
        osc.connect(gain);
        gain.connect(AUDIO.master);
        noiseSource.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(AUDIO.master);
        osc.start(clickTime);
        osc.stop(clickTime + 0.02);
        noiseSource.start(clickTime);
        noiseSource.stop(clickTime + 0.02);
        currentOffset += currentGap;
        currentGap *= acceleration;
    }
  }

//  function soundCrunch() {
//    if (!AUDIO.ctx) return;
//    const t = AUDIO.ctx.currentTime;
//    const numFolds = 35;
//    const initialGap = 0.08;
//    const acceleration = 0.92;
//    let currentOffset = 0;
//    let currentGap = initialGap;
//    const totalEstimatedDuration = 1.2;
//    const bufSize = AUDIO.ctx.sampleRate * totalEstimatedDuration;
//    const buffer = AUDIO.ctx.createBuffer(1, bufSize, AUDIO.ctx.sampleRate);
//    const data = buffer.getChannelData(0);
//    let b0, b1, b2, b3, b4, b5, b6;
//    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;
//    for (let i = 0; i < bufSize; i++) {
//        const white = Math.random() * 2 - 1;
//        b0 = 0.99886 * b0 + white * 0.0555179;
//        b1 = 0.99332 * b1 + white * 0.0750759;
//        b2 = 0.96900 * b2 + white * 0.1538520;
//        b3 = 0.86650 * b3 + white * 0.3104856;
//        b4 = 0.55000 * b4 + white * 0.5329522;
//        b5 = -0.7616 * b5 - white * 0.0168980;
//        data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
//        data[i] *= 0.11;
//        b6 = white * 0.115926;
//    }
//    const gain = AUDIO.ctx.createGain();
//    gain.gain.setValueAtTime(0, t);
//    for (let i = 0; i < numFolds; i++) {
//        const foldTime = t + currentOffset;
//        const volume = 0.5 + Math.random() * 0.5;
//        gain.gain.linearRampToValueAtTime(volume, foldTime + 0.004);
//        gain.gain.linearRampToValueAtTime(volume * 0.1, foldTime + 0.02);
//        currentOffset += currentGap;
//        currentGap *= acceleration;
//    }
//    const finalDuration = currentOffset + 0.05;
//    gain.gain.exponentialRampToValueAtTime(0.001, t + finalDuration);
//    const noise = AUDIO.ctx.createBufferSource();
//    noise.buffer = buffer;
//    const hp = AUDIO.ctx.createBiquadFilter();
//    hp.type = 'highpass';
//    hp.frequency.setValueAtTime(1000, t);
//    hp.frequency.exponentialRampToValueAtTime(400, t + finalDuration);
//    const bp = AUDIO.ctx.createBiquadFilter();
//    bp.type = 'bandpass';
//    bp.Q.value = 0.8;
//    bp.frequency.setValueAtTime(2200, t);
//    bp.frequency.exponentialRampToValueAtTime(800, t + finalDuration);
//    noise.connect(hp);
//    hp.connect(bp);
//    bp.connect(gain);
//    gain.connect(AUDIO.master);
//    noise.start(t);
//    noise.stop(t + finalDuration);
//  }

  /**
   * Plays a dense burst of sawtooth noise (golden ball spawn).
   */
  function soundCrunch() {
    if (!AUDIO.ctx) return;
    const t = AUDIO.ctx.currentTime;

    // Increased to 100 iterations for that extreme "crushing" effect
    for (let i = 0; i < 500; i++) {
      const timeOffset = Math.random() * 0.8;
      const osc = AUDIO.ctx.createOscillator();
      const g = AUDIO.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(2000 + Math.random() * 3000, t + timeOffset);
      osc.frequency.exponentialRampToValueAtTime(100, t + timeOffset + 0.02);

      g.gain.setValueAtTime(0, t + timeOffset);
      // Connect to the existing game audio system
      g.gain.linearRampToValueAtTime(Math.random() * 0.4, t + timeOffset + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + timeOffset + 0.015);

      osc.connect(g);
      // Use the global game master node so Mute works!
      g.connect(AUDIO.master);

      osc.start(t + timeOffset);
      osc.stop(t + timeOffset + 0.02);
    }
  }
  /**
   * Generates a noise buffer with randomised impact envelopes.
   *
   * @param {number} durationS  - Total buffer duration in seconds.
   * @param {number} sampleRate - Sample rate in Hz.
   * @param {number} ratePerSec - Mean number of impact events per second.
   * @param {number} decayS     - Exponential decay time constant per impact in seconds.
   * @param {number} jitter     - Relative timing jitter (0 = perfectly regular, 1 = fully random).
   * @param {number} ampMin     - Minimum impact amplitude.
   * @param {number} ampMax     - Maximum impact amplitude.
   * @returns {AudioBuffer} The generated noise buffer.
   */
  function makeImpactNoiseBuffer(durationS, sampleRate, ratePerSec, decayS, jitter, ampMin, ampMax) {
    const len = Math.max(1, Math.floor(durationS * sampleRate));
    const buf = AUDIO.ctx.createBuffer(1, len, sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const env = new Float32Array(len);
    const meanGap = 1 / ratePerSec;
    const decayK = 1 / Math.max(1e-4, decayS);
    const aMin = (ampMin === undefined) ? 0.4 : ampMin;
    const aMax = (ampMax === undefined) ? 1.0 : ampMax;
    let t = 0;
    while (t < durationS) {
      const idx = Math.floor(t * sampleRate);
      const amp = aMin + (aMax - aMin) * Math.random();
      const tailSamples = Math.min(len - idx, Math.floor(decayS * 6 * sampleRate));
      for (let k = 0; k < tailSamples; k++) {
        const localT = k / sampleRate;
        const v = amp * Math.exp(-decayK * localT);
        const j = idx + k;
        if (v > env[j]) env[j] = v;
      }
      const gap = meanGap * (1 + jitter * (Math.random() * 2 - 1));
      t += Math.max(0.001, gap);
    }
    for (let i = 0; i < len; i++) d[i] *= env[i];
    return buf;
  }

  /**
   * Plays the full mill sound sequence (blade, hiss, grind, thud, body) for the given duration.
   *
   * @param {number} durationS - Sustain duration of the mill sound in seconds.
   */
  function soundMillStart(durationS) {
    if (!AUDIO.ctx) return;
    if (MILL_HANDLE) { soundMillStop(MILL_HANDLE); MILL_HANDLE = null; }
    const t0 = AUDIO.ctx.currentTime;
    const minBurst = 0.18;
    const sustain = Math.max(durationS, minBurst);
    const attack = 0.06;
    const release = 0.12;
    const tEnd = t0 + attack + sustain + release;
    const totalLen = attack + sustain + release;

    const blade1 = AUDIO.ctx.createOscillator();
    const blade2 = AUDIO.ctx.createOscillator();
    blade1.type = 'square';
    blade2.type = 'square';
    const bladeBase = 1800;
    blade1.frequency.setValueAtTime(bladeBase, t0);
    blade2.frequency.setValueAtTime(bladeBase * 1.012, t0);
    const wobSteps = 10;
    for (let i = 1; i <= wobSteps; i++) {
      const ti = t0 + (i / wobSteps) * (attack + sustain);
      const w = 1 + 0.02 * Math.sin(i * 1.7);
      blade1.frequency.linearRampToValueAtTime(bladeBase * w, ti);
      blade2.frequency.linearRampToValueAtTime(bladeBase * 1.012 * w, ti);
    }

    const bladeLP = AUDIO.ctx.createBiquadFilter();
    bladeLP.type = 'lowpass';
    bladeLP.frequency.value = 3500;
    bladeLP.Q.value = 0.7;

    const bladeGain = AUDIO.ctx.createGain();
    bladeGain.gain.setValueAtTime(0, t0);
    bladeGain.gain.linearRampToValueAtTime(TUNING.audio.millBlade, t0 + attack);
    bladeGain.gain.setValueAtTime(TUNING.audio.millBlade, t0 + attack + sustain);
    bladeGain.gain.exponentialRampToValueAtTime(0.0005, tEnd);

    blade1.connect(bladeLP); blade2.connect(bladeLP);
    bladeLP.connect(bladeGain); bladeGain.connect(AUDIO.master);

    const noiseLen = Math.ceil(totalLen * AUDIO.ctx.sampleRate);
    const nb = AUDIO.ctx.createBuffer(1, Math.max(1, noiseLen), AUDIO.ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = AUDIO.ctx.createBufferSource(); noise.buffer = nb;
    const noiseBP = AUDIO.ctx.createBiquadFilter();
    noiseBP.type = 'bandpass';
    noiseBP.frequency.value = 2500;
    noiseBP.Q.value = 1.4;
    const noiseGain = AUDIO.ctx.createGain();
    noiseGain.gain.setValueAtTime(0, t0);
    noiseGain.gain.linearRampToValueAtTime(TUNING.audio.millHiss, t0 + attack);
    noiseGain.gain.setValueAtTime(TUNING.audio.millHiss, t0 + attack + sustain);
    noiseGain.gain.exponentialRampToValueAtTime(0.0005, tEnd);
    noise.connect(noiseBP); noiseBP.connect(noiseGain); noiseGain.connect(AUDIO.master);

    const grindBuf = makeImpactNoiseBuffer(totalLen, AUDIO.ctx.sampleRate, 25, 0.004, 0.6, 0.5, 1.4);
    const grind = AUDIO.ctx.createBufferSource(); grind.buffer = grindBuf;
    const grindBP = AUDIO.ctx.createBiquadFilter();
    grindBP.type = 'bandpass';
    grindBP.frequency.value = 5500;
    grindBP.Q.value = 0.9;
    const grindGain = AUDIO.ctx.createGain();
    grindGain.gain.setValueAtTime(0, t0);
    grindGain.gain.linearRampToValueAtTime(TUNING.audio.millGrind, t0 + attack);
    grindGain.gain.setValueAtTime(TUNING.audio.millGrind, t0 + attack + sustain);
    grindGain.gain.exponentialRampToValueAtTime(0.0005, tEnd);
    grind.connect(grindBP); grindBP.connect(grindGain); grindGain.connect(AUDIO.master);

    const thudBuf = makeImpactNoiseBuffer(totalLen, AUDIO.ctx.sampleRate, 7, 0.035, 0.6, 0.6, 1.2);
    const thud = AUDIO.ctx.createBufferSource(); thud.buffer = thudBuf;
    const thudBP = AUDIO.ctx.createBiquadFilter();
    thudBP.type = 'bandpass';
    thudBP.frequency.value = 320;
    thudBP.Q.value = 1.0;
    const thudGain = AUDIO.ctx.createGain();
    thudGain.gain.setValueAtTime(0, t0);
    thudGain.gain.linearRampToValueAtTime(TUNING.audio.millThud, t0 + attack);
    thudGain.gain.setValueAtTime(TUNING.audio.millThud, t0 + attack + sustain);
    thudGain.gain.exponentialRampToValueAtTime(0.0005, tEnd);
    thud.connect(thudBP); thudBP.connect(thudGain); thudGain.connect(AUDIO.master);

    const body = AUDIO.ctx.createOscillator();
    body.type = 'sine';
    body.frequency.value = 90;
    const bodyGain = AUDIO.ctx.createGain();
    bodyGain.gain.setValueAtTime(0, t0);
    bodyGain.gain.linearRampToValueAtTime(TUNING.audio.millBody, t0 + attack);
    bodyGain.gain.setValueAtTime(TUNING.audio.millBody, t0 + attack + sustain);
    bodyGain.gain.exponentialRampToValueAtTime(0.0005, tEnd);
    body.connect(bodyGain); bodyGain.connect(AUDIO.master);

    blade1.start(t0); blade2.start(t0); noise.start(t0);
    grind.start(t0); thud.start(t0); body.start(t0);
    blade1.stop(tEnd + 0.02);
    blade2.stop(tEnd + 0.02);
    noise.stop(tEnd + 0.02);
    grind.stop(tEnd + 0.02);
    thud.stop(tEnd + 0.02);
    body.stop(tEnd + 0.02);

    MILL_HANDLE = {
      blade1, blade2, noise, grind, thud, body,
      bladeGain, noiseGain, grindGain, thudGain, bodyGain,
      tEnd,
    };
    setTimeout(() => { if (MILL_HANDLE && MILL_HANDLE.tEnd <= AUDIO.ctx.currentTime + 0.01) MILL_HANDLE = null; },
               (attack + sustain + release) * 1000 + 50);
  }
  /**
   * Fades out an active mill handle returned by soundMillStart.
   *
   * @param {object} h - The mill handle object returned by soundMillStart.
   */
  function soundMillStop(h) {
    if (!AUDIO.ctx || !h) return;
    const t = AUDIO.ctx.currentTime;
    const tail = 0.05;
    try {
      const gains = [h.bladeGain, h.noiseGain, h.grindGain, h.thudGain, h.bodyGain];
      const sources = [h.blade1, h.blade2, h.noise, h.grind, h.thud, h.body];
      for (const g of gains) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.exponentialRampToValueAtTime(0.0005, t + tail);
      }
      for (const s of sources) s.stop(t + tail + 0.02);
    } catch (e) { /* */ }
  }

  let lastChimeTime = 0;
  const CHIME_COOLDOWN = 0.15; // 150ms between chimes to prevent flooding

  // NOTE: A duplicate definition without cooldown logic was removed here.
  /**
   * Plays the two-note levitation chime, with cooldown.
   */
  function soundChime() {
    if (!AUDIO.ctx) return;

    // COOLING OFF LOGIC
    const now = AUDIO.ctx.currentTime;
    if (now - lastChimeTime < CHIME_COOLDOWN) return;
    lastChimeTime = now;

    // EXISTING SOUND CODE
    const t = now;
    [880, 1320].forEach((f, i) => {
      const o = AUDIO.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = AUDIO.ctx.createGain();
      const start = t + i * 0.06;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.14, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
      o.connect(g); g.connect(AUDIO.master);
      o.start(start); o.stop(start + 0.65);
    });
  }

  /**
   * Plays the four-note golden arpeggio (aggregate gauge first appearance).
   */
  function soundGoldenChime() {
    if (!AUDIO.ctx) return;
    const t = AUDIO.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1174.66];
    notes.forEach((f, i) => {
      const o = AUDIO.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = AUDIO.ctx.createGain();
      const start = t + i * 0.07;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18 - i * 0.02, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 1.4);
      o.connect(g); g.connect(AUDIO.master);
      o.start(start); o.stop(start + 1.5);
    });
  }
  /**
   * Plays a pitched thud scaled to collision speed (golden ball bounce).
   *
   * @param {number} speed - Collision speed in cm/s; controls the thud amplitude.
   */
  function soundGoldenThud(speed) {
    if (!AUDIO.ctx) return;
    const t = AUDIO.ctx.currentTime;
    const amp = Math.min(0.4, speed / 400);
    const o = AUDIO.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
    const g = AUDIO.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g); g.connect(AUDIO.master);
    o.start(t); o.stop(t + 0.3);
  }

  /**
   * Initialises and/or resumes the AudioContext if suspended.
   */
  function ensureAudio() {
    if (!AUDIO.ctx) initAudio();
    if (AUDIO.ctx && AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume();
  }
  window.addEventListener('pointerdown', ensureAudio);
  window.addEventListener('keydown', ensureAudio);

  window.AUDIO          = AUDIO;
  window.initAudio      = initAudio;
  window.updateMotorSound = updateMotorSound;
  window.ensureAudio    = ensureAudio;
  window.soundTink      = soundTink;
  window.soundSnap      = soundSnap;
  window.soundCrunch    = soundCrunch;
  window.soundChime     = soundChime;
  window.soundMillStart = soundMillStart;
  window.soundMillStop  = soundMillStop;
  window.soundGoldenChime = soundGoldenChime;
  window.soundGoldenThud  = soundGoldenThud;
})();
