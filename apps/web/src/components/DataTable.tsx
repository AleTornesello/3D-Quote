import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { QueryError } from './QueryError'

export type Column<T> = {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
}

/** A list backed by a query: a skeleton while loading, an error with Retry, an empty state, or the rows. */
export function DataTable<T>({
  query,
  columns,
  rowKey,
  empty,
  caption,
}: {
  query: UseQueryResult<T[]>
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  empty: ReactNode
  caption: string
}) {
  const { t } = useTranslation()

  if (query.isPending) {
    return (
      <div role="status" aria-label={t('common.loading')} className="grid gap-2">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  const retry = () => void query.refetch()
  // A failed background refetch keeps the cached rows and shows the error above them.
  if (query.data === undefined) return <QueryError error={query.error} onRetry={retry} />
  const error = query.isError ? <QueryError error={query.error} onRetry={retry} /> : null
  if (query.data.length === 0) {
    return (
      <>
        {error}
        <p className="rounded-md border p-6 text-center text-muted-foreground">{empty}</p>
      </>
    )
  }
  return (
    <>
      {error}
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.map((row) => (
            <TableRow key={rowKey(row)}>
              {columns.map((column) => (
                <TableCell key={column.key} className={column.className}>
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}
