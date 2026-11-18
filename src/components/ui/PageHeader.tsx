import type { ReactNode } from 'react'

type Props = {
  eyebrow?: string
  title: string
  deck?: ReactNode
  children?: ReactNode
}

export default function PageHeader({ eyebrow, title, deck, children }: Props) {
  return (
    <header className="page-head">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <div className="page-head__row">
        <h1 className="page-head__title">{title}</h1>
        {children}
      </div>
      {deck && <p className="page-head__deck">{deck}</p>}
    </header>
  )
}
