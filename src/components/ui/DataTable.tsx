import { useMemo, useState, type ReactNode } from 'react'

export interface Column<T> {
  key: string
  label: string
  align?: 'left' | 'right'
  sortable?: boolean
  /** Raw value used for ordering; falls back to the rendered text. */
  sortValue?: (row: T) => number | string | null | undefined
  render: (row: T) => ReactNode
  className?: string
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  emptyMessage?: string
}

type Direction = 'asc' | 'desc'

function compare(a: number | string | null | undefined, b: number | string | null | undefined): number {
  const an = a === null || a === undefined || a === ''
  const bn = b === null || b === undefined || b === ''
  if (an && bn) return 0
  if (an) return 1 // missing values always sink
  if (bn) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

export default function DataTable<T>({ columns, rows, rowKey, initialSort, emptyMessage }: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: Direction } | null>(initialSort ?? null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((c) => c.key === sort.key)
    if (!column) return rows
    const value = (row: T) => (column.sortValue ? column.sortValue(row) : null)
    return [...rows].sort((a, b) => {
      const result = compare(value(a), value(b))
      return sort.dir === 'asc' ? result : -result
    })
  }, [rows, sort, columns])

  const toggle = (column: Column<T>) => {
    if (!column.sortable) return
    setSort((current) => {
      if (!current || current.key !== column.key) return { key: column.key, dir: 'desc' }
      return { key: column.key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
    })
  }

  return (
    <div className="table-scroll">
      <table className="stat-table stat-table--sortable">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key
              return (
                <th
                  key={column.key}
                  className={[
                    column.align === 'right' ? 'is-num' : '',
                    column.sortable ? 'is-sortable' : '',
                    column.className ?? '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : column.sortable ? 'none' : undefined}
                >
                  {column.sortable ? (
                    <button type="button" className="th-sort" onClick={() => toggle(column)}>
                      <span>{column.label}</span>
                      <span className={`th-sort__arrow${active ? ' is-active' : ''}`} aria-hidden="true">
                        {active ? (sort?.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'is-num' : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {!sorted.length && (
            <tr>
              <td colSpan={columns.length} className="muted" style={{ textAlign: 'left' }}>
                {emptyMessage ?? 'No rows.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
