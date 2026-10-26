/** Number formatting shared by the Strategy Tester views, in TradingView's style (U+2212 minus). */

const MINUS = "−";

const signed = (value: number, digits: number): string =>
  `${value < 0 ? MINUS : ""}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const formatMoney = (value: number, currency: string): string => `${signed(value, 2)} ${currency}`;

export const formatPercent = (value: number): string => `${signed(value, 2)}%`;

export const formatRatio = (value: number | undefined): string => {
  if (value === undefined || Number.isNaN(value)) return "—";
  return value === Infinity ? "∞" : signed(value, 3);
};

export const formatDuration = (ms: number | undefined): string => {
  if (ms === undefined) return "—";
  const hours = ms / 3_600_000;
  if (hours < 24) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
};

export const formatDateTime = (time: number): string =>
  new Date(time).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export const formatDate = (time: number): string =>
  new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export const pnlClass = (value: number): string => {
  if (value > 0) return "text-[#089981]";
  return value < 0 ? "text-[#f23645]" : "";
};
