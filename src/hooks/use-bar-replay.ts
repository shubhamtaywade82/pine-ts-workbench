import { useCallback, useEffect, useState } from "react";
import {
  clampReplayIndex,
  initialReplayIndex,
  stepReplayIndex,
} from "@/lib/bar-replay";

export interface BarReplayState {
  readonly isReplay: boolean;
  readonly replayIndex: number;
  readonly isPlaying: boolean;
  readonly speedMs: number;
  readonly startReplay: (index?: number) => void;
  readonly stopReplay: () => void;
  readonly togglePlay: () => void;
  readonly stepForward: () => void;
  readonly setReplayIndex: (index: number) => void;
  readonly setSpeedMs: (speedMs: number) => void;
}

/**
 * Manages candle replay state, playback timer, and stepping through historical bars.
 */
export function useBarReplay(totalBars: number): BarReplayState {
  const [isReplay, setIsReplay] = useState(false);
  const [replayIndex, setReplayIndexState] = useState(totalBars);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(1000);

  const startReplay = useCallback(
    (index?: number) => {
      setReplayIndexState(index !== undefined ? clampReplayIndex(index, totalBars) : initialReplayIndex(totalBars));
      setIsReplay(true);
      setIsPlaying(false);
    },
    [totalBars],
  );

  const stopReplay = useCallback(() => {
    setIsReplay(false);
    setIsPlaying(false);
    setReplayIndexState(totalBars);
  }, [totalBars]);

  const setReplayIndex = useCallback(
    (index: number) => {
      setReplayIndexState(clampReplayIndex(index, totalBars));
    },
    [totalBars],
  );

  const stepForward = useCallback(() => {
    setReplayIndexState((curr) => {
      const { nextIndex, isDone } = stepReplayIndex(curr, totalBars);
      if (isDone) setIsPlaying(false);
      return nextIndex;
    });
  }, [totalBars]);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev && replayIndex >= totalBars) {
        setReplayIndexState(initialReplayIndex(totalBars));
      }
      return !prev;
    });
  }, [replayIndex, totalBars]);

  // Advance replay bar by bar when playback is active.
  useEffect(() => {
    if (!isReplay || !isPlaying) return;
    const interval = setInterval(() => {
      setReplayIndexState((curr) => {
        const { nextIndex, isDone } = stepReplayIndex(curr, totalBars);
        if (isDone) setIsPlaying(false);
        return nextIndex;
      });
    }, speedMs);
    return () => clearInterval(interval);
  }, [isReplay, isPlaying, speedMs, totalBars]);

  return {
    isReplay,
    replayIndex,
    isPlaying,
    speedMs,
    startReplay,
    stopReplay,
    togglePlay,
    stepForward,
    setReplayIndex,
    setSpeedMs,
  };
}
