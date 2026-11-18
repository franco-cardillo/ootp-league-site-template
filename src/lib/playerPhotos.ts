/** Accept only the current importer's ID-bound, content-addressed portrait paths. */
export function playerPhotoPath(index: unknown, id: number): string | null {
  if (!Number.isSafeInteger(id) || id <= 0 || !index || typeof index !== 'object') return null
  const entry = (index as Record<string, unknown>)[String(id)]
  if (typeof entry !== 'string') return null
  const match = /^photos\/(\d{1,7})-[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/.exec(entry)
  return match?.[1] === String(id) ? entry : null
}

export type LoadedPlayerPhoto = { id: number; url: string }

/** Never show a previously loaded player's face while a different ID is being resolved. */
export function currentPlayerPhoto(photo: LoadedPlayerPhoto | null, id: number): string | null {
  return photo?.id === id ? photo.url : null
}
