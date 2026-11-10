import { WallTracker, type WallFrame, type WallOptions, type BookView } from "./depth-walls";
import type { DepthFeedState, DepthStatus } from "./depth-feed";

/**
 * Turns depth-feed states into wall updates: observation continues frame after
 * frame while the book stays live, and resets on connecting/syncing/stale so a
 * wall's `observedSince` never spans a feed break.
 */
export interface DepthWallsUpdate {
  readonly status: DepthStatus;
  readonly frame: WallFrame | undefined;
  readonly observedUntil: number;
  readonly quoteAsset: string;
  readonly error?: string;
}

export class WallObserver {
  private readonly tracker: WallTracker;
  private lastState: DepthFeedState | undefined;
  private frame: WallFrame | undefined;
  private observing = false;
  private observedUntil = 0;

  public constructor(
    options: WallOptions,
    private readonly quoteAsset: string,
    private readonly now: () => number,
    private readonly emit: (update: DepthWallsUpdate) => void,
  ) {
    this.tracker = new WallTracker(options);
  }

  public receive(state: DepthFeedState): void {
    this.lastState = state;
    this.apply(state);
    this.publish(state);
  }

  public setOptions(options: WallOptions): void {
    this.tracker.setOptions(options);
    if (this.lastState !== undefined) this.receive(this.lastState);
  }

  private apply(state: DepthFeedState): void {
    if (state.status === "live" && state.book !== undefined) {
      const now = this.now();
      this.frame = this.tracker.update(state.book, now);
      this.observedUntil = now;
      this.observing = true;
      return;
    }
    if (this.observing) {
      this.tracker.reset();
      this.observing = false;
    }
  }

  private publish(state: DepthFeedState): void {
    this.emit({
      status: state.status,
      frame: this.frame,
      observedUntil: this.observedUntil,
      quoteAsset: this.quoteAsset,
      ...(state.error === undefined ? {} : { error: state.error }),
    });
  }
}
