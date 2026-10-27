"use client";

import { memo } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  StepForward,
  X,
} from "lucide-react";
import { REPLAY_SPEEDS } from "@/lib/bar-replay";

export interface ReplayControlsProps {
  readonly isPlaying: boolean;
  readonly replayIndex: number;
  readonly totalBars: number;
  readonly speedMs: number;
  readonly onTogglePlay: () => void;
  readonly onStepForward: () => void;
  readonly onRestart: () => void;
  readonly onSeek: (index: number) => void;
  readonly onSpeedChange: (speedMs: number) => void;
  readonly onClose: () => void;
}

export const ReplayControls = memo(function ReplayControls({
  isPlaying,
  replayIndex,
  totalBars,
  speedMs,
  onTogglePlay,
  onStepForward,
  onRestart,
  onSeek,
  onSpeedChange,
  onClose,
}: ReplayControlsProps) {
  const currentSpeed = REPLAY_SPEEDS.find((s) => s.ms === speedMs) ?? REPLAY_SPEEDS[2]!;

  const cycleSpeed = () => {
    const idx = REPLAY_SPEEDS.findIndex((s) => s.ms === speedMs);
    const nextIdx = (idx + 1) % REPLAY_SPEEDS.length;
    onSpeedChange(REPLAY_SPEEDS[nextIdx]!.ms);
  };

  return (
    <div className="absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#2a2e39] bg-[#1e222d]/95 px-3 py-1 text-xs text-white shadow-xl backdrop-blur-md">
      <div className="flex items-center gap-1 font-mono text-[11px] text-[#b2b5be]">
        <span className="font-semibold text-white">{replayIndex}</span>
        <span>/</span>
        <span>{totalBars}</span>
      </div>

      <input
        type="range"
        min={5}
        max={totalBars}
        value={replayIndex}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="h-1.5 w-24 cursor-pointer accent-[#2962ff]"
        title="Scrub replay bar"
      />

      <div className="h-3.5 w-px bg-[#2a2e39]" />

      <button
        type="button"
        title="Restart replay from 50 bars ago"
        onClick={onRestart}
        className="flex h-6 w-6 items-center justify-center rounded text-[#b2b5be] hover:bg-[#2a2e39] hover:text-white"
      >
        <RotateCcw className="h-3 w-3" />
      </button>

      <button
        type="button"
        title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        onClick={onTogglePlay}
        className="flex h-6 w-6 items-center justify-center rounded bg-[#2962ff] text-white hover:bg-[#1e54e4]"
      >
        {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 fill-current" />}
      </button>

      <button
        type="button"
        title="Step forward 1 bar"
        onClick={onStepForward}
        disabled={replayIndex >= totalBars}
        className="flex h-6 w-6 items-center justify-center rounded text-[#b2b5be] hover:bg-[#2a2e39] hover:text-white disabled:opacity-30"
      >
        <StepForward className="h-3 w-3" />
      </button>

      <button
        type="button"
        title="Playback speed"
        onClick={cycleSpeed}
        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[#b2b5be] hover:bg-[#2a2e39] hover:text-white"
      >
        {currentSpeed.label}
      </button>

      <div className="h-3.5 w-px bg-[#2a2e39]" />

      <button
        type="button"
        title="Exit Replay mode"
        onClick={onClose}
        className="flex h-6 w-6 items-center justify-center rounded text-[#b2b5be] hover:bg-[#2a2e39] hover:text-[#f23645]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
