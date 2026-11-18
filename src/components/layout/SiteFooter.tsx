import { formatStamp } from '../../lib/live'
import type { ImportMeta } from '../../lib/types'

type FooterMeta = Pick<ImportMeta, 'demo' | 'generatedAt' | 'simDate'>

export default function SiteFooter({ meta }: { meta: FooterMeta | null | undefined }) {
  const demo = meta?.demo === true

  return (
    <footer className="footer">
      <div className="container footer__inner">
        <span>
          {demo
            ? 'OOTP Baseball Universe — fictional sample data. Generated '
            : meta
              ? 'OOTP Baseball Universe — a personal league record. Data updated '
              : 'OOTP Baseball Universe — league data. Data updated '}
          <strong>{formatStamp(meta?.generatedAt)}</strong>
          {meta?.simDate ? ` · ${demo ? 'sample date' : 'sim through'} ${meta.simDate}` : ''}
        </span>
        <span>
          {demo
            ? 'Data source: synthetic demo data, not an OOTP save or export.'
            : meta
              ? 'Data source: Out of the Park Baseball 27 exports.'
              : 'Data source unavailable.'}
        </span>
      </div>
    </footer>
  )
}
