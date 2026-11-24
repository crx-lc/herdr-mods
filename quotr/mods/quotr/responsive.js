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
  return { compact: width < 380, short: Boolean(size && size.height < 360),
    band: Boolean(size && size.height < 72 && width >= 600), maxWidth: WIDTHS.useful,
    // Emergency wrapping below the proposed minimum; no content min-width.
    chunk: width < WIDTHS.minimum ? Math.max(1, Math.min(8, Math.floor((width - 48) / 9))) : 10 };
}
// Explicit wrap opportunities for long symbols/prices, without changing their text.
export function textChunks(text, length) {
  const chars = Array.from(String(text));
  const result = [];
  for (let i = 0; i < chars.length; i += length) result.push(chars.slice(i, i + length).join(""));
  return result;
}
