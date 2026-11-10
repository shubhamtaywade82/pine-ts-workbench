"use client";

import type { BinanceSymbol } from "./public-binance-feed";
import { closeQuietly, quoteAssetOf, releaseSocket } from "./public-binance-feed";
import { BINANCE_REST_URL } from "./binance-endpoints";
import { isDepthSnapshot, isDepthUpdate } from "./binance-payloads";
import type { WallOptions } from "./depth-walls";
import type { DepthSnapshot, DepthUpdate } from "./order-book";
import {
  DepthFeed,
  WallObserver,
  type DepthFeedDeps,
  type DepthFeedState,
  type DepthWallsUpdate,
} from "./depth-feed";

const DEPTH_SNAPSHOT_URL = `${BINANCE_REST_URL}/api/v3/depth`;

export const openDepthSocket: DepthFeedDeps["openSocket"] = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.onopen = handlers.onOpen;
  socket.onclose = handlers.onClose;
  socket.onerror = () => { if (socket.readyState === WebSocket.OPEN) closeQuietly(socket); };
  socket.onmessage = (message) => {
    let update: DepthUpdate | undefined;
    let malformed = false;
    try {
      const { data } = JSON.parse(message.data as string) as { data?: unknown };
      if (isDepthUpdate(data)) update = data;
      else malformed = true;
    } catch {
      malformed = true;
    }
    if (malformed) handlers.onMalformed();
    else if (update) handlers.onMessage(update);
  };
  return () => releaseSocket(socket);
};

const truncateText = (text: string, maxLen = 200): string =>
  text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;

export const fetchSnapshot: DepthFeedDeps["fetchSnapshot"] = async (symbol, limit) => {
  const res = await fetch(`${DEPTH_SNAPSHOT_URL}?symbol=${symbol}&limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${truncateText(await res.text())}`);
  const body: unknown = await res.json();
  if (!isDepthSnapshot(body)) {
    throw new Error(`Invalid depth snapshot for ${symbol}: ${truncateText(JSON.stringify(body))}`);
  }
  return body;
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
