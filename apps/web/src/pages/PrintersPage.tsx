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
import { useFormat } from '@/lib/use-format'
import { PrinterSheet } from './printers/PrinterSheet'

export function PrintersPage() {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const format = useFormat()
  const printers = usePrinters()
  const save = useSavePrinter()
  const remove = useDeletePrinter()
  const [editing, setEditing] = useState<Printer | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Printer | null>(null)
  const [type, setType] = useState<PrinterType | null>(null)

  const columns: Column<Printer>[] = [
    {
      key: 'name',
      header: t('printers.fields.name'),
      cell: (p) => <span className="font-medium">{p.name}</span>,
    },
    { key: 'model', header: t('printers.fields.model'), cell: (p) => p.model },
    { key: 'type', header: t('printers.fields.type'), cell: (p) => p.type },
    {
      key: 'rate',
      header: t('printers.fields.hourlyRate'),
      cell: (p) => t('printers.rateValue', { value: format.currency(p.hourly_rate) }),
    },
    {
      key: 'power',
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

  // Few printers, all loaded: the type filter runs here rather than in the query.
  const tableQuery: TableQuery<Printer> = {
    isPending: printers.isPending,
    isError: printers.isError,
    error: printers.error,
    data: type ? printers.data?.filter((p) => p.type === type) : printers.data,
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
