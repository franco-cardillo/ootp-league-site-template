import { Link } from 'react-router-dom'

type Props = {
  title: string
  eyebrow: string
  note: string
}

export default function Placeholder({ title, eyebrow, note }: Props) {
  return (
    <div className="container page">
      <p className="eyebrow">{eyebrow}</p>
      <h1 style={{ fontSize: 'var(--fs-display)', textTransform: 'uppercase', margin: 'var(--sp-2) 0 var(--sp-4)' }}>
        {title}
      </h1>
      <hr className="rule" />
      <p style={{ maxWidth: 620, marginTop: 'var(--sp-4)', color: 'var(--text-2)', fontSize: 'var(--fs-lead)' }}>
        {note}
      </p>
      <p style={{ marginTop: 'var(--sp-5)' }}>
        <Link to="/" className="link-quiet">
          ← Back to the front page
        </Link>
      </p>
    </div>
  )
}
