// Content policy only. Never resize the host or persist measurements.
// Width proposals are provisional until native Windows previews and interactions.
export const WIDTHS = { minimum: 280, suggested: 340, useful: 440 };
export function measuredSize(next, previous = null) {
  if (!next || !Number.isFinite(next.width) || !Number.isFinite(next.height) || next.width <= 0 || next.height <= 0) return previous;
  const width = Math.round(next.width), height = Math.round(next.height);
  if (width <= 0 || height <= 0) return previous;
  return previous?.width === width && previous?.height === height ? previous : { width, height };
}
export function contentPolicy(size) {
  const width = size?.width ?? WIDTHS.minimum;
  return { compact: width < 380, width: Math.min(width, WIDTHS.useful), short: Boolean(size && size.height < 360),
    band: Boolean(size && size.height < 72), maxWidth: WIDTHS.useful,
    // Emergency wrapping below the proposed minimum; no content min-width.
    chunk: width < WIDTHS.minimum ? Math.max(1, Math.min(8, Math.floor((width - 48) / 9))) : 10 };
}
// Staged allocation, with conservative character budgets (not native glyph metrics).
// Ordinary default rows retain the 31.5 logo and 56x22 chart. Exceptional primary
// text gets the whole row; chart/logo availability is independent of stacking.
export function rowPolicy(policy, symbol, price) {
  const logo = policy.width >= 300;
  const chart = policy.width >= 340;
  const identity = policy.width - 42 - 108 - (chart ? 66 : 0) - (logo ? 39.5 : 0) - 10;
  const stack = policy.width < 300 || symbol.length * 8 > identity ||
    price.trim().split(/\s+/)[0].length > 10 || price.length > 12;
  return { logo, chart, stack };
}
// Financial atoms break only at semantic whitespace. Signed numbers, grouping,
// decimal precision, percent suffixes and currency codes stay indivisible.
export function valueAtoms(text) {
  return String(text).match(/\S+\s*/g) ?? [];
}
// Fixed chunks are exclusively for symbols, never financial values.
export function textChunks(text, length) {
  const chars = Array.from(String(text));
  const result = [];
  for (let i = 0; i < chars.length; i += length) result.push(chars.slice(i, i + length).join(""));
  return result;
}
