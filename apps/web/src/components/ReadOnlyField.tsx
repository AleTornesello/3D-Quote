import type { ReactNode } from 'react'

/** A value shown to people who can't edit it. Place inside a <dl>. */
export function ReadOnlyField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-line">{value === null || value === '' ? '—' : value}</dd>
    </div>
  )
}
