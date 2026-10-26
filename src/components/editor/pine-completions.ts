import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

const TA_COMPLETIONS: readonly Completion[] = [
  { label: "rsi", type: "function", detail: "(source, length = 14)", info: "Relative Strength Index" },
  { label: "ema", type: "function", detail: "(source, length)", info: "Exponential Moving Average" },
  { label: "sma", type: "function", detail: "(source, length)", info: "Simple Moving Average" },
  { label: "macd", type: "function", detail: "(source, fast, slow, signal)", info: "Moving Average Convergence Divergence" },
  { label: "stoch", type: "function", detail: "(close, high, low, length)", info: "Stochastic Oscillator" },
  { label: "atr", type: "function", detail: "(length = 14)", info: "Average True Range" },
  { label: "supertrend", type: "function", detail: "(factor, atrPeriod)", info: "Supertrend indicator" },
  { label: "crossover", type: "function", detail: "(source1, source2)", info: "True if source1 crossed over source2" },
  { label: "crossunder", type: "function", detail: "(source1, source2)", info: "True if source1 crossed under source2" },
  { label: "highest", type: "function", detail: "(source, length)", info: "Highest value over lookback window" },
  { label: "lowest", type: "function", detail: "(source, length)", info: "Lowest value over lookback window" },
  { label: "bb", type: "function", detail: "(source, length, mult)", info: "Bollinger Bands [middle, upper, lower]" },
  { label: "change", type: "function", detail: "(source, length = 1)", info: "Difference between current value and value N bars ago" },
  { label: "mom", type: "function", detail: "(source, length)", info: "Momentum indicator" },
];

const SMC_COMPLETIONS: readonly Completion[] = [
  { label: "fairValueGaps", type: "function", detail: "(options?)", info: "Detects bullish and bearish FVGs" },
  { label: "liquidity", type: "function", detail: "(options?)", info: "Detects liquidity pools and swept swing levels" },
  { label: "structure", type: "function", detail: "(options?)", info: "Tracks market structure: BOS and CHoCH" },
  { label: "orderBlocks", type: "function", detail: "(options?)", info: "Identifies institutional order block zones" },
];

const DRAW_COMPLETIONS: readonly Completion[] = [
  { label: "fvg", type: "function", detail: "(zone, style?)", info: "Draws an FVG box on the active chart" },
  { label: "structure", type: "function", detail: "(swing, style?)", info: "Draws BOS / CHoCH structure line" },
  { label: "line", type: "function", detail: "(x1, y1, x2, y2, style?)", info: "Draws a line segment" },
  { label: "box", type: "function", detail: "(left, top, right, bottom, style?)", info: "Draws a box region" },
];

const STRATEGY_COMPLETIONS: readonly Completion[] = [
  { label: "entry", type: "function", detail: "(id, direction, options?)", info: "Places an order to enter a position" },
  { label: "close", type: "function", detail: "(id, options?)", info: "Closes an open position by entry id" },
  { label: "exit", type: "function", detail: "(id, options?)", info: "Places bracket exit orders (profit/loss)" },
  { label: "long", type: "variable", detail: "Direction.Long", info: "Long entry direction" },
  { label: "short", type: "variable", detail: "Direction.Short", info: "Short entry direction" },
  { label: "position_size", type: "variable", detail: "Series<number>", info: "Current position size in contracts/shares" },
  { label: "netprofit", type: "variable", detail: "number", info: "Cumulative strategy net profit" },
  { label: "openprofit", type: "variable", detail: "number", info: "Current unrealized profit/loss" },
];

const INPUT_COMPLETIONS: readonly Completion[] = [
  { label: "int", type: "function", detail: "(defval, title, options?)", info: "Integer input field" },
  { label: "float", type: "function", detail: "(defval, title, options?)", info: "Floating-point number input field" },
  { label: "bool", type: "function", detail: "(defval, title, options?)", info: "Boolean checkbox input" },
  { label: "string", type: "function", detail: "(defval, title, options?)", info: "Text or options dropdown input" },
  { label: "color", type: "function", detail: "(defval, title)", info: "Color picker input" },
];

const ROOT_COMPLETIONS: readonly Completion[] = [
  { label: "indicator", type: "keyword", detail: "indicator(title, callback)", info: "Declares an indicator script" },
  { label: "defineStrategy", type: "keyword", detail: "defineStrategy(title, options, callback)", info: "Declares a strategy script" },
  { label: "plot", type: "function", detail: "(series, title?, style?)", info: "Plots a series on the chart" },
  { label: "hline", type: "function", detail: "(price, title?, style?)", info: "Plots a horizontal reference line" },
  { label: "close", type: "variable", detail: "Series<number>", info: "Bar closing price" },
  { label: "open", type: "variable", detail: "Series<number>", info: "Bar opening price" },
  { label: "high", type: "variable", detail: "Series<number>", info: "Bar highest price" },
  { label: "low", type: "variable", detail: "Series<number>", info: "Bar lowest price" },
  { label: "volume", type: "variable", detail: "Series<number>", info: "Bar volume" },
  { label: "bar_index", type: "variable", detail: "Series<number>", info: "Current bar index (0 to N-1)" },
];

export function pineCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const text = word.text;
  if (text.startsWith("ta.")) {
    return { from: word.from + 3, options: [...TA_COMPLETIONS] };
  }
  if (text.startsWith("smc.")) {
    return { from: word.from + 4, options: [...SMC_COMPLETIONS] };
  }
  if (text.startsWith("draw.")) {
    return { from: word.from + 5, options: [...DRAW_COMPLETIONS] };
  }
  if (text.startsWith("strategy.")) {
    return { from: word.from + 9, options: [...STRATEGY_COMPLETIONS] };
  }
  if (text.startsWith("input.")) {
    return { from: word.from + 6, options: [...INPUT_COMPLETIONS] };
  }

  // Root scope completions
  return {
    from: word.from,
    options: [...ROOT_COMPLETIONS, ...TA_COMPLETIONS.map((c) => ({ ...c, label: `ta.${c.label}` }))],
  };
}
