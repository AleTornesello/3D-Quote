import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStaff } from '@/auth/staff-context'
import { DataTable, type Column, type TableQuery } from '@/components/DataTable'
import { DeleteCatalogItemDialog } from '@/components/DeleteCatalogItemDialog'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

type MaterialSort = 'name' | 'type' | 'color' | 'cost' | 'density'
type SortDir = 'asc' | 'desc'

/** Costs and densities open from the highest value; text from A. */
const DESC_FIRST: readonly MaterialSort[] = ['cost', 'density']

/** Missing values go last in both directions; ties fall back to the name. */
function sortMaterials(
  rows: Material[],
  value: (m: Material) => string | number | null,
  dir: SortDir,
  collator: Intl.Collator,
) {
  const sign = dir === 'asc' ? 1 : -1
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
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: MaterialSort; dir: SortDir }>({
    key: 'name',
    dir: 'asc',
  })
  const typeLabel = (m: Material) => (m.type === 'other' ? t('materials.types.other') : m.type)

  function onSort(key: string) {
    const next = key as MaterialSort
    if (next === sort.key) setSort({ key: next, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
    else setSort({ key: next, dir: DESC_FIRST.includes(next) ? 'desc' : 'asc' })
  }

  const columns: Column<Material>[] = [
    {
      key: 'name',
      header: t('materials.fields.name'),
      sortKey: 'name',
      cell: (m) => <span className="font-medium">{m.name}</span>,
    },
    {
      key: 'type',
      header: t('materials.fields.type'),
      sortKey: 'type',
      cell: typeLabel,
    },
    {
      key: 'color',
      header: t('materials.fields.color'),
      sortKey: 'color',
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
      sortKey: 'cost',
      cell: (m) => t('materials.costValue', { value: format.currency(m.cost_per_kg) }),
    },
    {
      key: 'density',
      header: t('materials.columns.density'),
      sortKey: 'density',
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

  // Few materials, all loaded: the filters and the sort run here rather than in the query.
  const needle = search.trim().toLocaleLowerCase()
  const filtering = type !== null || needle !== ''
  const sortValue: Record<MaterialSort, (m: Material) => string | number | null> = {
    name: (m) => m.name,
    type: typeLabel,
    color: (m) => m.color || null,
    cost: (m) => m.cost_per_kg,
    density: (m) => m.density_g_cm3,
  }
  const filtered = filtering
    ? materials.data?.filter(
        (m) => (type === null || m.type === type) && m.name.toLocaleLowerCase().includes(needle),
      )
    : materials.data
  const tableQuery: TableQuery<Material> = {
    isPending: materials.isPending,
    isError: materials.isError,
    error: materials.error,
    data:
      filtered &&
      sortMaterials(
        filtered,
        sortValue[sort.key],
        sort.dir,
        new Intl.Collator(format.locale, { numeric: true }),
      ),
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
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input
          type="search"
          aria-label={t('materials.search')}
          placeholder={t('materials.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-xs"
        />
        <NativeSelect
          aria-label={t('materials.typeFilter')}
          value={type ?? ''}
          onChange={(event) =>
            setType(MATERIAL_TYPES.find((value) => value === event.target.value) ?? null)
          }
        >
          <NativeSelectOption value="">{t('materials.allTypes')}</NativeSelectOption>
          {MATERIAL_TYPES.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {value === 'other' ? t('materials.types.other') : value}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <DataTable
        query={tableQuery}
        columns={columns}
        rowKey={(m) => m.id}
        caption={t('nav.materials')}
        onRowDoubleClick={isOwner ? setEditing : undefined}
        sort={{ key: sort.key, dir: sort.dir, onSort }}
        empty={t(filtering ? 'materials.noMatches' : 'materials.empty')}
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
