"use client";

import type { BinanceSymbol } from "./public-binance-feed";
import { quoteAssetOf } from "./public-binance-feed";
import type { WallOptions } from "./depth-walls";
import type { DepthSnapshot, DepthUpdate } from "./order-book";
import {
  DepthFeed,
  WallObserver,
  type DepthFeedDeps,
  type DepthFeedState,
  type DepthWallsUpdate,
} from "./depth-feed";

const DEPTH_SNAPSHOT_URL = "https://data-api.binance.vision/api/v3/depth";

const closeQuietly = (socket: WebSocket): void => {
  try { socket.close(1000, "Normal closure"); } catch { /* already closing */ }
};

const releaseSocket = (socket: WebSocket): void => {
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.onopen = () => closeQuietly(socket);
    return;
  }
  socket.onopen = null;
  if (socket.readyState === WebSocket.OPEN) closeQuietly(socket);
};

const openDepthSocket: DepthFeedDeps["openSocket"] = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.onopen = handlers.onOpen;
  socket.onclose = handlers.onClose;
  socket.onerror = () => { if (socket.readyState === WebSocket.OPEN) closeQuietly(socket); };
  socket.onmessage = (message) => {
    const { data } = JSON.parse(message.data as string) as { data: DepthUpdate & { e?: string } };
    if (data.e === "depthUpdate") handlers.onMessage(data);
  };
  return () => releaseSocket(socket);
};

const fetchSnapshot: DepthFeedDeps["fetchSnapshot"] = async (symbol, limit) => {
  const res = await fetch(`${DEPTH_SNAPSHOT_URL}?symbol=${symbol}&limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as DepthSnapshot;
};

const browserDeps: DepthFeedDeps = {
  now: () => Date.now(),
  schedule: (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
  openSocket: openDepthSocket,
  fetchSnapshot,
};

const sharedFeeds = new Map<BinanceSymbol, DepthFeed>();

const feedFor = (symbol: BinanceSymbol): DepthFeed => {
  const existing = sharedFeeds.get(symbol);
  if (existing !== undefined && !existing.isStopped) return existing;
  const feed = new DepthFeed(symbol, browserDeps);
  sharedFeeds.set(symbol, feed);
  return feed;
};

export interface WallsSubscription {
  /** Applies new wall options immediately, without reconnecting. */
  setOptions(options: WallOptions): void;
  unsubscribe(): void;
}

/** Live walls for `symbol`, one shared connection per symbol. Options can change without reconnecting. */
export const subscribeDepthWalls = (
  symbol: BinanceSymbol,
  options: WallOptions,
  listener: (update: DepthWallsUpdate) => void,
): WallsSubscription => {
  const feed = feedFor(symbol);
  const observer = new WallObserver(options, quoteAssetOf(symbol), browserDeps.now, listener);
  feed.setWindow(observer, options.windowPct);
  const unsubscribeFeed = feed.subscribe((state) => observer.receive(state));
  return {
    setOptions: (next) => {
      feed.setWindow(observer, next.windowPct);
      observer.setOptions(next);
    },
    unsubscribe: () => {
      feed.setWindow(observer, undefined);
      unsubscribeFeed();
    },
  };
};

export interface BookSubscription {
  /** Moves the coverage window without reconnecting. */
  setWindow(windowPct: number): void;
  unsubscribe(): void;
}

/** Registers `windowPct` on a feed and forwards its state. Used by `subscribeBook` and tests. */
export const bindDepthFeed = (
  feed: DepthFeed,
  windowPct: number | undefined,
  listener: (state: DepthFeedState) => void,
): BookSubscription => {
  const owner = {};
  if (windowPct !== undefined) feed.setWindow(owner, windowPct);
  const unsubscribeFeed = feed.subscribe(listener);
  return {
    setWindow: (next) => feed.setWindow(owner, next),
    unsubscribe: () => {
      feed.setWindow(owner, undefined);
      unsubscribeFeed();
    },
  };
};

/** Live book for `symbol`, sharing the per-symbol depth socket with the wall overlay. */
export const subscribeBook = (
  symbol: BinanceSymbol,
  windowPct: number | undefined,
  listener: (state: DepthFeedState) => void,
): BookSubscription => bindDepthFeed(feedFor(symbol), windowPct, listener);
