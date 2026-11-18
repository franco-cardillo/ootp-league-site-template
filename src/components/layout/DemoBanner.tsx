import type { ImportMeta } from '../../lib/types'

/** Only an explicit demo flag may label a bundle as fictional. */
export default function DemoBanner({ meta }: { meta: Pick<ImportMeta, 'demo'> | null | undefined }) {
  if (meta?.demo !== true) return null

  return (
    <div className="demo-banner" role="status" aria-label="Demo data notice">
      <div className="container demo-banner__inner">
        <strong className="demo-banner__tag">Demo data</strong>
        <span>Fictional sample data — not a real league or OOTP save.</span>
      </div>
    </div>
  )
}
