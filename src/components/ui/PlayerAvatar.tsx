import { useEffect, useState } from 'react'
import { currentPlayerPhoto, playerPhotoPath, type LoadedPlayerPhoto } from '../../lib/playerPhotos'

type Props = {
  id: number
  name: string
  color?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const sizePx = { sm: 26, md: 38, lg: 56, xl: 84 } as const

let photoIndex: Promise<Record<string, string>> | null = null

/**
 * OOTP's CSV export contains no images: portraits live as files in the save folder. When those
 * files are supplied to the importer, photos.json maps player id → file and they are used here.
 * Otherwise the player gets a monogram in the club's color, never a stock photo.
 */
function loadPhotoIndex(): Promise<Record<string, string>> {
  if (!photoIndex) {
    // The index is overwritten at each import; never reuse a stale browser-cached mapping.
    photoIndex = fetch(`${import.meta.env.BASE_URL}data/photos.json`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}))
  }
  return photoIndex
}

const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

export default function PlayerAvatar({ id, name, color = '#111111', size = 'md' }: Props) {
  const [loaded, setLoaded] = useState<LoadedPlayerPhoto | null>(null)
  const photo = currentPlayerPhoto(loaded, id)
  const px = sizePx[size]

  useEffect(() => {
    let live = true
    loadPhotoIndex().then((index) => {
      const entry = playerPhotoPath(index, id)
      if (live) setLoaded(entry ? { id, url: `${import.meta.env.BASE_URL}data/${entry}` } : null)
    })
    return () => {
      live = false
    }
  }, [id])

  if (photo) {
    return (
      <img
        className={`avatar avatar--${size}`}
        src={photo}
        alt={name}
        width={px}
        height={px}
        loading="lazy"
        // A portrait listed in the index but missing from the bundle falls back to the monogram
        // rather than a broken image.
        onError={() => setLoaded((current) => current?.id === id && current.url === photo ? null : current)}
        style={{ borderColor: color }}
      />
    )
  }

  return (
    <span
      className={`avatar avatar--${size} avatar--mono`}
      style={{ width: px, height: px, borderColor: color, color }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  )
}
