import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useClients, type ClientListRow } from '@/data/clients'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useFormat } from '@/lib/use-format'
import { ClientSheet } from './clients/ClientSheet'

export function ClientsPage() {
  const { t } = useTranslation()
  const format = useFormat()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const clients = useClients(debounced)
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const edit = (c: ClientListRow) => navigate(`/clients/${c.id}`)

  const columns: Column<ClientListRow>[] = [
    {
      key: 'name',
      header: t('clients.fields.name'),
      cell: (c) => <span className="font-medium">{c.name}</span>,
    },
    { key: 'company', header: t('clients.fields.company'), cell: (c) => c.company ?? '—' },
    { key: 'email', header: t('clients.fields.email'), cell: (c) => c.email ?? '—' },
    { key: 'phone', header: t('clients.fields.phone'), cell: (c) => c.phone ?? '—' },
    {
      key: 'quotes',
      header: t('clients.columns.quotes'),
      className: 'text-right',
      cell: (c) => format.number(c.quoteCount),
    },
    {
      key: 'lastQuote',
      header: t('clients.columns.lastQuote'),
      cell: (c) => (c.lastQuoteAt ? format.date(c.lastQuoteAt) : '—'),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      className: 'text-right',
      cell: (c) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.editItem', { name: c.name })}
          onClick={() => edit(c)}
        >
          <Pencil aria-hidden />
        </Button>
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
        query={clients}
        columns={columns}
        rowKey={(c) => c.id}
        caption={t('nav.clients')}
        empty={t(debounced.trim() ? 'clients.noMatches' : 'clients.empty')}
        onRowDoubleClick={edit}
      />
      {creating && <ClientSheet onClose={() => setCreating(false)} />}
    </section>
  )
}
