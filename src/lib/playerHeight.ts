/** Format an OOTP height in centimeters as feet and whole inches. */
export function formatPlayerHeight(heightCm: unknown): string {
  if (typeof heightCm !== 'number' || !Number.isFinite(heightCm) || heightCm <= 0) return '—'

  const inches = Math.round(heightCm / 2.54)
  if (!Number.isSafeInteger(inches) || inches <= 0) return '—'

  return `${Math.floor(inches / 12)}'${inches % 12}"`
}
