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
  MATERIAL_TYPES,
  useDeleteMaterial,
  useMaterials,
  useSaveMaterial,
  type Material,
  type MaterialType,
} from '@/data/materials'
import { useFormat } from '@/lib/use-format'
import { MaterialSheet } from './materials/MaterialSheet'

export function MaterialsPage() {
  const { t } = useTranslation()
  const { isOwner } = useStaff()
  const format = useFormat()
  const materials = useMaterials()
  const save = useSaveMaterial()
  const remove = useDeleteMaterial()
  const [editing, setEditing] = useState<Material | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Material | null>(null)
  const [type, setType] = useState<MaterialType | null>(null)

  const columns: Column<Material>[] = [
    {
      key: 'name',
      header: t('materials.fields.name'),
      cell: (m) => <span className="font-medium">{m.name}</span>,
    },
    {
      key: 'type',
      header: t('materials.fields.type'),
      cell: (m) => (m.type === 'other' ? t('materials.types.other') : m.type),
    },
    {
      key: 'color',
      header: t('materials.fields.color'),
      cell: (m) =>
        m.color ? (
          <span className="inline-flex items-center gap-2">
            {/^#[0-9a-f]{6}$/i.test(m.color) && (
              <span
                aria-hidden
                className="size-4 rounded-full border"
                style={{ backgroundColor: m.color }}
              />
            )}
            {m.color}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'cost',
      header: t('materials.fields.costPerKg'),
      cell: (m) => t('materials.costValue', { value: format.currency(m.cost_per_kg) }),
    },
    {
      key: 'density',
      header: t('materials.columns.density'),
      cell: (m) => t('materials.densityValue', { value: format.number(m.density_g_cm3, 2) }),
    },
    {
      key: 'active',
      header: t('materials.fields.active'),
      cell: (m) =>
        isOwner ? (
          <Switch
            checked={m.active}
            aria-label={t('materials.toggleActive', { name: m.name })}
            onCheckedChange={(active) => save.mutate({ id: m.id, values: { active } })}
          />
        ) : (
          t(m.active ? 'common.yes' : 'common.no')
        ),
    },
  ]
  if (isOwner) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      className: 'text-right',
      cell: (m) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.editItem', { name: m.name })}
            onClick={() => setEditing(m)}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.deleteItem', { name: m.name })}
            onClick={() => setDeleting(m)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ),
    })
  }

  // Few materials, all loaded: the type filter runs here rather than in the query.
  const tableQuery: TableQuery<Material> = {
    isPending: materials.isPending,
    isError: materials.isError,
    error: materials.error,
    data: type ? materials.data?.filter((m) => m.type === type) : materials.data,
    refetch: materials.refetch,
  }

  return (
    <section>
      <PageHeader
        title={t('nav.materials')}
        actions={
          isOwner && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('materials.new')}
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
        aria-label={t('materials.typeFilter')}
        value={type ?? ''}
        onChange={(event) =>
          setType(MATERIAL_TYPES.find((value) => value === event.target.value) ?? null)
        }
        className="mb-4"
      >
        <NativeSelectOption value="">{t('materials.allTypes')}</NativeSelectOption>
        {MATERIAL_TYPES.map((value) => (
          <NativeSelectOption key={value} value={value}>
            {value === 'other' ? t('materials.types.other') : value}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <DataTable
        query={tableQuery}
        columns={columns}
        rowKey={(m) => m.id}
        caption={t('nav.materials')}
        onRowDoubleClick={isOwner ? setEditing : undefined}
        empty={t(type ? 'materials.noMatches' : 'materials.empty')}
      />
      {editing && (
        <MaterialSheet
          material={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteCatalogItemDialog
          title={t('materials.deleteTitle', { name: deleting.name })}
          inUseMessage={t('materials.inUse')}
          onDelete={() => remove.mutateAsync(deleting.id)}
          onDeactivate={() => save.mutateAsync({ id: deleting.id, values: { active: false } })}
          onClose={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
