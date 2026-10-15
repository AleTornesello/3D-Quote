import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useStaff } from '@/auth/staff-context'
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog'
import { DataTable, type Column, type TableQuery } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useClients, useDeleteClient, type ClientListRow } from '@/data/clients'
import { toAppError } from '@/data/errors'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useFormat } from '@/lib/use-format'
import { ClientSheet } from './clients/ClientSheet'

type ClientSort = 'name' | 'company' | 'email' | 'quotes' | 'lastQuote'
type SortDir = 'asc' | 'desc'

const SORT_VALUE: Record<ClientSort, (c: ClientListRow) => string | number | null> = {
  name: (c) => c.name,
  company: (c) => c.company,
  email: (c) => c.email,
  quotes: (c) => c.quoteCount,
  lastQuote: (c) => (c.lastQuoteAt ? Date.parse(c.lastQuoteAt) : null),
}

/** Counts and dates open from the highest value; text from A. */
const DESC_FIRST: ClientSort[] = ['quotes', 'lastQuote']

/** Missing values go last in both directions; ties fall back to the name. */
function sortClients(
  rows: ClientListRow[],
  sort: ClientSort,
  dir: SortDir,
  collator: Intl.Collator,
) {
  const sign = dir === 'asc' ? 1 : -1
  const value = SORT_VALUE[sort]
  return [...rows].sort((a, b) => {
    const x = value(a)
    const y = value(b)
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1
    } else {
      const order =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : collator.compare(String(x), String(y))
      if (order !== 0) return sign * order
    }
    return collator.compare(a.name, b.name) || a.id - b.id
  })
}

export function ClientsPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const clients = useClients(debounced)
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const { isOwner } = useStaff()
  const remove = useDeleteClient()
  const [deleting, setDeleting] = useState<ClientListRow | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: ClientSort; dir: SortDir }>({ key: 'name', dir: 'asc' })
  const edit = (c: ClientListRow) => navigate(`/clients/${c.id}`)

  function closeDelete() {
    setDeleting(null)
    setDeleteError(null)
  }

  async function confirmDelete(c: ClientListRow) {
    setDeleteError(null)
    try {
      await remove.mutateAsync(c.id)
      closeDelete()
    } catch (error) {
      const appError = toAppError(error)
      setDeleteError(t(appError.kind === 'inUse' ? 'clients.inUse' : appError.messageKey))
    }
  }

  function onSort(key: string) {
    const next = key as ClientSort
    if (next === sort.key) setSort({ key: next, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
    else setSort({ key: next, dir: DESC_FIRST.includes(next) ? 'desc' : 'asc' })
  }

  // The list is not paginated and holds every match: sorting here also covers the embedded quote count and date.
  const tableQuery: TableQuery<ClientListRow> = {
    isPending: clients.isPending,
    isError: clients.isError,
    error: clients.error,
    data:
      clients.data &&
      sortClients(
        clients.data,
        sort.key,
        sort.dir,
        new Intl.Collator(format.locale, { numeric: true }),
      ),
    refetch: clients.refetch,
  }

  const columns: Column<ClientListRow>[] = [
    {
      key: 'name',
      header: t('clients.fields.name'),
      sortKey: 'name',
      cell: (c) => <span className="font-medium">{c.name}</span>,
    },
    {
      key: 'company',
      header: t('clients.fields.company'),
      sortKey: 'company',
      cell: (c) => c.company ?? '—',
    },
    {
      key: 'email',
      header: t('clients.fields.email'),
      sortKey: 'email',
      cell: (c) => c.email ?? '—',
    },
    { key: 'phone', header: t('clients.fields.phone'), cell: (c) => c.phone ?? '—' },
    {
      key: 'quotes',
      header: t('clients.columns.quotes'),
      className: 'text-right',
      sortKey: 'quotes',
      cell: (c) => format.number(c.quoteCount),
    },
    {
      key: 'lastQuote',
      header: t('clients.columns.lastQuote'),
      sortKey: 'lastQuote',
      cell: (c) => (c.lastQuoteAt ? format.date(c.lastQuoteAt) : '—'),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      className: 'text-right',
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.editItem', { name: c.name })}
            onClick={() => edit(c)}
          >
            <Pencil aria-hidden />
          </Button>
          {/* Only the owner can delete, and only clients without quotes (as on the client's page). */}
          {isOwner && c.quoteCount === 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('common.deleteItem', { name: c.name })}
              onClick={() => setDeleting(c)}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <section>
      <PageHeader
        title={t('nav.clients')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('clients.new')}
          </Button>
        }
      />
      <Input
        type="search"
        aria-label={t('clients.search')}
        placeholder={t('clients.search')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="mb-4 max-w-sm"
      />
      <DataTable
        query={tableQuery}
        columns={columns}
        rowKey={(c) => c.id}
        caption={t('nav.clients')}
        sort={{ key: sort.key, dir: sort.dir, onSort }}
        empty={t(debounced.trim() ? 'clients.noMatches' : 'clients.empty')}
        onRowDoubleClick={edit}
      />
      {deleting && (
        <ConfirmDeleteDialog
          title={t('clients.detail.deleteTitle', { name: deleting.name })}
          pending={remove.isPending}
          error={deleteError}
          onConfirm={() => void confirmDelete(deleting)}
          onCancel={closeDelete}
        />
      )}
      {creating && <ClientSheet onClose={() => setCreating(false)} />}
    </section>
  )
}
