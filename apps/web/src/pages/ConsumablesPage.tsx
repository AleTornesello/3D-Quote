import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { DataTable, type Column } from '@/components/DataTable'
import { DeleteCatalogItemDialog } from '@/components/DeleteCatalogItemDialog'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  useConsumables,
  useDeleteConsumable,
  useSaveConsumable,
  type Consumable,
  type ConsumableListRow,
} from '@/data/consumables'
import { toAppError } from '@/data/errors'
import { useFormat } from '@/lib/use-format'
import { ConsumableSheet } from './consumables/ConsumableSheet'

export function ConsumablesPage() {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const format = useFormat()
  const consumables = useConsumables()
  const save = useSaveConsumable()
  const remove = useDeleteConsumable()
  const [editing, setEditing] = useState<Consumable | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Consumable | null>(null)

  const columns: Column<ConsumableListRow>[] = [
    {
      key: 'name',
      header: t('consumables.fields.name'),
      cell: (c) => <span className="font-medium">{c.name}</span>,
    },
    {
      key: 'unitPrice',
      header: t('consumables.fields.unitPrice'),
      cell: (c) => format.currency(c.unit_price),
    },
    {
      key: 'stock',
      header: t('consumables.columns.stock'),
      cell: (c) =>
        t('consumables.stockOfTotal', {
          available: format.number(c.stock),
          total: format.number(c.stock + c.reserved),
          unit: c.unit,
        }),
    },
    {
      key: 'active',
      header: t('consumables.fields.active'),
      cell: (c) =>
        isOwner ? (
          <Switch
            checked={c.active}
            aria-label={t('consumables.toggleActive', { name: c.name })}
            onCheckedChange={(active) => save.mutate({ id: c.id, values: { active } })}
          />
        ) : (
          t(c.active ? 'common.yes' : 'common.no')
        ),
    },
  ]
  if (isOwner) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      className: 'text-right',
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.editItem', { name: c.name })}
            onClick={() => setEditing(c)}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.deleteItem', { name: c.name })}
            onClick={() => setDeleting(c)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ),
    })
  }

  return (
    <section>
      <PageHeader
        title={t('nav.consumables')}
        actions={
          isOwner && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('consumables.new')}
            </Button>
          )
        }
      />
      {save.isError && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {t(toAppError(save.error).messageKey)}
        </p>
      )}
      <DataTable
        query={consumables}
        columns={columns}
        rowKey={(c) => c.id}
        caption={t('nav.consumables')}
        onRowDoubleClick={isOwner ? setEditing : undefined}
        empty={t('consumables.empty')}
      />
      {editing && (
        <ConsumableSheet
          consumable={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteCatalogItemDialog
          title={t('consumables.deleteTitle', { name: deleting.name })}
          inUseMessage={t('consumables.inUse')}
          onDelete={() => remove.mutateAsync(deleting.id)}
          onDeactivate={() => save.mutateAsync({ id: deleting.id, values: { active: false } })}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
