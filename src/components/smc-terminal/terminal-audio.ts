let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let isMuted = false;

export function initAudio(): void {
  if (audioCtx !== null || typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = isMuted ? 0 : 0.9;
    masterGain.connect(audioCtx.destination);
  } catch {
    // AudioContext may be blocked before first user gesture
  }
}

export function resumeAudioIfNeeded(): void {
  if (audioCtx?.state === "suspended") {
    void audioCtx.resume();
  }
}

export function setSoundMuted(muted: boolean): void {
  isMuted = muted;
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : 0.9;
  }
}

export function isSoundEnabled(): boolean {
  return !isMuted;
}

function playBeep(f0: number, f1: number, dur: number, type: OscillatorType, vol: number): void {
  if (!audioCtx || !masterGain || isMuted || audioCtx.state !== "running") return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(f0, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dur);

  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

export const playSound = {
  wall: (): void => playBeep(660, 880, 0.12, "sine", 0.06),
  held: (): void => playBeep(520, 540, 0.09, "triangle", 0.07),
  pull: (): void => playBeep(200, 110, 0.14, "sine", 0.08),
  brk: (): void => playBeep(240, 80, 0.18, "sawtooth", 0.045),
  kill: (): void => playBeep(440, 90, 0.3, "square", 0.05),
  ui: (): void => playBeep(900, 880, 0.03, "sine", 0.025),
};
