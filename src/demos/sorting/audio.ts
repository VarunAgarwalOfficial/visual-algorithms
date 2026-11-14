/**
 * A single quiet oscillator that plays one short note per call. Notes closer
 * together than `MIN_GAP` seconds are dropped, so fast playback gives a steady
 * stream of blips instead of a crackle. The audio context is only made on the
 * first note, which must come after a user gesture (ticking the checkbox).
 */
const MIN_GAP = 0.03;
const LOW_HZ = 160;
const HIGH_HZ = 1280;

export interface Tone {
  /** Plays a note whose pitch rises with `level`, from 0 (low) to 1 (high). */
  note(level: number): void;
  /** Silences the current note at once. */
  stop(): void;
  dispose(): void;
}

export function createTone(): Tone {
  let context: AudioContext | undefined;
  let oscillator: OscillatorNode | undefined;
  let gain: GainNode | undefined;
  let lastNote = -1;

  function start(): boolean {
    if (context) return true;
    if (typeof AudioContext === 'undefined') return false;
    context = new AudioContext();
    oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    gain = context.createGain();
    gain.gain.value = 0;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    return true;
  }

  return {
    note(level) {
      if (!start() || !context || !oscillator || !gain) return;
      if (context.state === 'suspended') void context.resume();
      const now = context.currentTime;
      if (now - lastNote < MIN_GAP) return;
      lastNote = now;
      const clamped = Math.max(0, Math.min(1, level));
      // Three octaves, so equal steps in value are equal musical steps.
      oscillator.frequency.setValueAtTime(LOW_HZ * (HIGH_HZ / LOW_HZ) ** clamped, now);
      // A short ramp up and down avoids the click of a hard edge.
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.008);
      gain.gain.linearRampToValueAtTime(0, now + 0.09);
    },
    stop() {
      if (!context || !gain) return;
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.01);
    },
    dispose() {
      oscillator?.stop();
      void context?.close();
      context = undefined;
    },
  };
}
