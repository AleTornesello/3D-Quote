import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
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
import { formatNumber, localeFor } from '@/lib/format'
import { QueryError } from './QueryError'

export type Column<T> = {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
  /** Makes the header a sort button; passed to `sort.onSort`. */
  sortKey?: string
}

/** What DataTable reads from a query; any `useQuery` result over `T[]` fits. */
export type TableQuery<T> = {
  isPending: boolean
  isError: boolean
  error: unknown
  data: T[] | undefined
  refetch: () => unknown
}

/** A list backed by a query: a skeleton while loading, an error with Retry, an empty state, or the rows. */
export function DataTable<T>({
  query,
  columns,
  rowKey,
  empty,
  caption,
  sort,
  pagination,
}: {
  query: TableQuery<T>
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  empty: ReactNode
  caption: string
  sort?: { key: string; dir: 'asc' | 'desc'; onSort: (key: string) => void }
  pagination?: { page: number; pageSize: number; total: number; onPage: (page: number) => void }
}) {
  const { t, i18n } = useTranslation()

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
            {columns.map((column) => {
              const active = sort !== undefined && column.sortKey === sort.key
              const ariaSort = active
                ? sort.dir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : undefined
              const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
              return (
                <TableHead key={column.key} className={column.className} aria-sort={ariaSort}>
                  {sort && column.sortKey ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium"
                      onClick={() => sort.onSort(column.sortKey as string)}
                    >
                      {column.header}
                      <Icon aria-hidden className={active ? 'size-3.5' : 'size-3.5 opacity-40'} />
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              )
            })}
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
      {pagination && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {t('common.pageRange', {
              from: formatNumber(
                (pagination.page - 1) * pagination.pageSize + 1,
                localeFor(i18n.language),
              ),
              to: formatNumber(
                Math.min(pagination.page * pagination.pageSize, pagination.total),
                localeFor(i18n.language),
              ),
              total: formatNumber(pagination.total, localeFor(i18n.language)),
            })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPage(pagination.page - 1)}
            >
              {t('common.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page * pagination.pageSize >= pagination.total}
              onClick={() => pagination.onPage(pagination.page + 1)}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
