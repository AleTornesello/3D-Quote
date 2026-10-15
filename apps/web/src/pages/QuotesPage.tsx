import { Clock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { useStaff } from '@/auth/staff-context'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { DataTable, type Column, type TableQuery } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_QUOTE_LIST,
  expiresSoon,
  hasFilters,
  parseQuoteListParams,
  toQuoteListSearch,
  type QuoteListParams,
  type QuoteSort,
} from '@/data/quote-rules'
import { toAppError } from '@/data/errors'
import { QUOTES_PAGE_SIZE, useDeleteQuote, useQuotesList, type QuoteListRow } from '@/data/quotes'
import { shopToday } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import { NewQuoteSheet } from './quotes/NewQuoteSheet'
import { QuoteFilters } from './quotes/QuoteFilters'
import { QuoteStatusBadge } from './quotes/QuoteStatusBadge'

/** The quotes list. `creating` (the /quotes/new route) opens the New quote sheet over it. */
export function QuotesPage({ creating = false }: { creating?: boolean }) {
  const { t } = useTranslation()
  const format = useFormat()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const params = parseQuoteListParams(searchParams)
  const list = useQuotesList(params)
  const { isOwner } = useStaff()
  const remove = useDeleteQuote()
  const [deleting, setDeleting] = useState<QuoteListRow | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [today] = useState(shopToday)

  const search = searchParams.toString()
  const update = useCallback(
    (change: Partial<QuoteListParams>) => {
      const current = parseQuoteListParams(new URLSearchParams(search))
      setSearchParams(toQuoteListSearch({ ...current, page: 1, ...change }), { replace: true })
    },
    [search, setSearchParams],
  )

  const outOfRange = list.data?.outOfRange === true
  useEffect(() => {
    if (outOfRange && params.page !== 1) update({ page: 1 })
  }, [outOfRange, params.page, update])

  function onSort(key: string) {
    const sort = key as QuoteSort
    const dir =
      sort === params.sort
        ? params.dir === 'asc'
          ? 'desc'
          : 'asc'
        : sort === 'valid_until'
          ? 'asc'
          : 'desc'
    update({ sort, dir })
  }

  const clearFilters = () =>
    update({ q: '', status: [], client: null, from: null, to: null, page: DEFAULT_QUOTE_LIST.page })

  const edit = (q: QuoteListRow) => navigate(`/quotes/${q.id}`)

  function closeDelete() {
    setDeleting(null)
    setDeleteError(null)
  }

  async function confirmDelete(q: QuoteListRow) {
    setDeleteError(null)
    try {
      await remove.mutateAsync(q.id)
      closeDelete()
    } catch (caught) {
      setDeleteError(t(toAppError(caught).messageKey))
    }
  }

  const columns: Column<QuoteListRow>[] = [
    {
      key: 'number',
      sortKey: 'number',
      header: t('quotes.columns.number'),
      cell: (q) => <span className="font-medium">{q.number}</span>,
    },
    {
      key: 'client',
      header: t('quotes.columns.client'),
      cell: (q) => (
        <div className="grid">
          <span>{q.client_name}</span>
          {q.client_company && (
            <span className="text-xs text-muted-foreground">{q.client_company}</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('quotes.columns.status'),
      cell: (q) => <QuoteStatusBadge status={q.status} />,
    },
    {
      key: 'total',
      sortKey: 'total',
      header: t('quotes.columns.total'),
      className: 'text-right',
      cell: (q) => (q.total === null ? '—' : format.currency(q.total)),
    },
    {
      key: 'created',
      sortKey: 'created',
      header: t('quotes.columns.created'),
      className: 'hidden md:table-cell',
      cell: (q) => (
        <div className="grid">
          <span>{format.date(q.created_at)}</span>
          <span className="text-xs text-muted-foreground">
            {t('quotes.createdBy', { name: q.created_by_name })}
          </span>
        </div>
      ),
    },
    {
      key: 'validUntil',
      sortKey: 'valid_until',
      header: t('quotes.columns.validUntil'),
      cell: (q) => (
        <span className="inline-flex flex-wrap items-center gap-x-2">
          {format.date(q.valid_until)}
          {expiresSoon(q, today) && (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <Clock aria-hidden className="size-3.5" />
              {t('quotes.expiresSoon')}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      className: 'text-right',
      cell: (q) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.editItem', { name: q.number })}
            onClick={() => edit(q)}
          >
            <Pencil aria-hidden />
          </Button>
          {/* Only the owner can delete, and only drafts (as in the editor). */}
          {isOwner && q.status === 'draft' && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('common.deleteItem', { name: q.number })}
              onClick={() => setDeleting(q)}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      ),
    },
  ]

  const tableQuery: TableQuery<QuoteListRow> = {
    isPending: list.isPending,
    isError: list.isError,
    error: list.error,
    data: list.data?.rows,
    refetch: list.refetch,
  }
  const filtered = hasFilters(params)

  return (
    <section>
      <PageHeader
        title={t('nav.quotes')}
        actions={
          <Button onClick={() => navigate('/quotes/new')}>
            <Plus aria-hidden />
            {t('quotes.new')}
          </Button>
        }
      />
      <QuoteFilters params={params} onChange={update} onClear={clearFilters} />
      <DataTable
        query={tableQuery}
        columns={columns}
        rowKey={(q) => q.id}
        caption={t('nav.quotes')}
        onRowDoubleClick={edit}
        sort={{ key: params.sort, dir: params.dir, onSort }}
        pagination={{
          page: params.page,
          pageSize: QUOTES_PAGE_SIZE,
          total: list.data?.count ?? 0,
          onPage: (page) => update({ page }),
        }}
        empty={
          filtered ? (
            <>
              {t('quotes.noMatches')}{' '}
              <Button variant="link" onClick={clearFilters}>
                {t('quotes.filters.clear')}
              </Button>
            </>
          ) : (
            t('quotes.empty')
          )
        }
      />
      {deleting && (
        <ConfirmDeleteDialog
          title={t('quotes.editor.deleteTitle', { number: deleting.number })}
          pending={remove.isPending}
          error={deleteError}
          onConfirm={() => void confirmDelete(deleting)}
          onCancel={closeDelete}
        />
      )}
      {creating && <NewQuoteSheet clientId={params.client} onClose={() => navigate('/quotes')} />}
    </section>
  )
}
