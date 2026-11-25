export const START = Date.UTC(2026, 0, 12, 14, 30);
export const END = START + 6.5 * 3_600_000;
export const NOW = END + 60_000;
export function fixture(series = [130, 130.2, 129.9, 130.1, 130], overrides = {}) {
  return { symbol: "SAMPLE", name: "Sample instrument", price: series.at(-1) ?? 130,
    previousClose: 100, changePercent: ((series.at(-1) ?? 130) - 100),
    timestamp: END - 300_000, fetchedAt: NOW, currency: "USD", delaySeconds: 0,
    periods: { regular: [START, END] }, series,
    points: series.map((close, i) => ({ close, t: START + i * (END - START - 300_000) / Math.max(1, series.length - 1) })),
    ...overrides };
}
export const scenarios = [
  ["Large positive gap, sideways", fixture()],
  ["Large negative gap", fixture([70, 69.8, 70.1, 69.9, 70])],
  ["Ordinary small move", fixture([100, 100.5, 100.2, 100.8, 101])],
  ["Unavailable reference", fixture([130, 130.2, 129.9, 130.1, 130], { previousClose: null, changePercent: null })],
];
