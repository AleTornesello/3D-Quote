import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { DataTable, type Column, type TableQuery } from '@/components/DataTable'
import { DeleteCatalogItemDialog } from '@/components/DeleteCatalogItemDialog'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { toAppError } from '@/data/errors'
import {
  PRINTER_TYPES,
  useDeletePrinter,
  usePrinters,
  useSavePrinter,
  type Printer,
  type PrinterType,
} from '@/data/printers'
import { localeFor } from '@/lib/format'
import { useFormat } from '@/lib/use-format'
import { PrinterSheet } from './printers/PrinterSheet'

type PrinterSort = 'name' | 'model' | 'type' | 'rate' | 'power'

const NUMERIC_SORTS: readonly PrinterSort[] = ['rate', 'power']

function comparePrinters(sort: PrinterSort, collator: Intl.Collator) {
  return (a: Printer, b: Printer): number => {
    switch (sort) {
      case 'name':
        return collator.compare(a.name, b.name)
      case 'model':
        return collator.compare(a.model, b.model)
      case 'type':
        return collator.compare(a.type, b.type)
      case 'rate':
        return a.hourly_rate - b.hourly_rate
      case 'power':
        return a.power_w - b.power_w
    }
  }
}

export function PrintersPage() {
  const { t, i18n } = useTranslation()
  const { isOwner } = useStaff()
  const format = useFormat()
  const printers = usePrinters()
  const save = useSavePrinter()
  const remove = useDeletePrinter()
  const [editing, setEditing] = useState<Printer | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Printer | null>(null)
  const [type, setType] = useState<PrinterType | null>(null)
  const [sort, setSort] = useState<{ key: PrinterSort; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  })

  function onSort(key: string) {
    const next = key as PrinterSort
    setSort((current) =>
      current.key === next
        ? { key: next, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : // Numbers start from the highest, text from A.
          { key: next, dir: NUMERIC_SORTS.includes(next) ? 'desc' : 'asc' },
    )
  }

  const columns: Column<Printer>[] = [
    {
      key: 'name',
      sortKey: 'name',
      header: t('printers.fields.name'),
      cell: (p) => <span className="font-medium">{p.name}</span>,
    },
    {
      key: 'model',
      sortKey: 'model',
      header: t('printers.fields.model'),
      cell: (p) => p.model,
    },
    { key: 'type', sortKey: 'type', header: t('printers.fields.type'), cell: (p) => p.type },
    {
      key: 'rate',
      sortKey: 'rate',
      header: t('printers.fields.hourlyRate'),
      cell: (p) => t('printers.rateValue', { value: format.currency(p.hourly_rate) }),
    },
    {
      key: 'power',
      sortKey: 'power',
      header: t('printers.columns.power'),
      cell: (p) => `${format.number(p.power_w)} W`,
    },
    {
      key: 'active',
      header: t('printers.fields.active'),
      cell: (p) =>
        isOwner ? (
          <Switch
            checked={p.active}
            aria-label={t('printers.toggleActive', { name: p.name })}
            onCheckedChange={(active) => save.mutate({ id: p.id, values: { active } })}
          />
        ) : (
          t(p.active ? 'common.yes' : 'common.no')
        ),
    },
  ]
  if (isOwner) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      className: 'text-right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.editItem', { name: p.name })}
            onClick={() => setEditing(p)}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.deleteItem', { name: p.name })}
            onClick={() => setDeleting(p)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ),
    })
  }

  // Few printers, all loaded: the type filter and the sort run here rather than in the query.
  const collator = new Intl.Collator(localeFor(i18n.language), {
    numeric: true,
    sensitivity: 'base',
  })
  const byKey = comparePrinters(sort.key, collator)
  const byName = comparePrinters('name', collator)
  const rows = printers.data
    ?.filter((p) => type === null || p.type === type)
    .sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * byKey(a, b) || byName(a, b))
  const tableQuery: TableQuery<Printer> = {
    isPending: printers.isPending,
    isError: printers.isError,
    error: printers.error,
    data: rows,
    refetch: printers.refetch,
  }

  return (
    <section>
      <PageHeader
        title={t('nav.printers')}
        actions={
          isOwner && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('printers.new')}
            </Button>
          )
        }
      />
      {save.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t(toAppError(save.error).messageKey)}
        </p>
      )}
      <NativeSelect
        aria-label={t('printers.typeFilter')}
        value={type ?? ''}
        onChange={(event) =>
          setType(PRINTER_TYPES.find((value) => value === event.target.value) ?? null)
        }
        className="mb-4"
      >
        <NativeSelectOption value="">{t('printers.allTypes')}</NativeSelectOption>
        {PRINTER_TYPES.map((value) => (
          <NativeSelectOption key={value} value={value}>
            {value}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <DataTable
        query={tableQuery}
        columns={columns}
        rowKey={(p) => p.id}
        caption={t('nav.printers')}
        onRowDoubleClick={isOwner ? setEditing : undefined}
        sort={{ key: sort.key, dir: sort.dir, onSort }}
        empty={t(type ? 'printers.noMatches' : 'printers.empty')}
      />
      {editing && (
        <PrinterSheet
          printer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteCatalogItemDialog
          title={t('printers.deleteTitle', { name: deleting.name })}
          inUseMessage={t('printers.inUse')}
          onDelete={() => remove.mutateAsync(deleting.id)}
          onDeactivate={() => save.mutateAsync({ id: deleting.id, values: { active: false } })}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
