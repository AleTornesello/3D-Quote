import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useClientOptions } from '@/data/clients'
import { hasFilters, QUOTE_STATUSES, type QuoteListParams } from '@/data/quote-rules'
import { useDebouncedValue } from '@/lib/use-debounced-value'

export function QuoteFilters({
  params,
  onChange,
  onClear,
}: {
  params: QuoteListParams
  onChange: (change: Partial<QuoteListParams>) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const clients = useClientOptions()
  const [text, setText] = useState(params.q)
  const debounced = useDebouncedValue(text, 300)

  // Only once typing has settled (debounced caught up with text): Clear filters empties `text` at once, and the stale
  // debounced value must not put the old search back.
  useEffect(() => {
    if (debounced === text && debounced.trim() !== params.q.trim()) onChange({ q: debounced })
  }, [debounced, text, params.q, onChange])

  function toggleStatus(status: (typeof QUOTE_STATUSES)[number], checked: boolean) {
    const next = checked ? [...params.status, status] : params.status.filter((s) => s !== status)
    onChange({ status: QUOTE_STATUSES.filter((s) => next.includes(s)) })
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Input
        type="search"
        aria-label={t('quotes.search')}
        placeholder={t('quotes.search')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="max-w-xs"
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">
            {params.status.length
              ? t('quotes.filters.statusCount', { count: params.status.length })
              : t('quotes.filters.status')}
            <ChevronDown aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="grid w-48 gap-2">
          {QUOTE_STATUSES.map((status) => (
            <Label key={status} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={params.status.includes(status)}
                onCheckedChange={(checked) => toggleStatus(status, checked === true)}
              />
              {t(`quotes.status.${status}`)}
            </Label>
          ))}
        </PopoverContent>
      </Popover>
      <div className="grid gap-1">
        <Label htmlFor="filter-client">{t('quotes.filters.client')}</Label>
        <NativeSelect
          id="filter-client"
          value={params.client === null ? '' : String(params.client)}
          onChange={(event) =>
            onChange({ client: event.target.value ? Number(event.target.value) : null })
          }
        >
          <NativeSelectOption value="">{t('quotes.filters.anyClient')}</NativeSelectOption>
          {clients.data?.map((client) => (
            <NativeSelectOption key={client.id} value={String(client.id)}>
              {client.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="filter-from">{t('quotes.filters.from')}</Label>
        <Input
          id="filter-from"
          type="date"
          value={params.from ?? ''}
          onChange={(event) => onChange({ from: event.target.value || null })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="filter-to">{t('quotes.filters.to')}</Label>
        <Input
          id="filter-to"
          type="date"
          value={params.to ?? ''}
          onChange={(event) => onChange({ to: event.target.value || null })}
        />
      </div>
      {hasFilters(params) && (
        <Button
          variant="ghost"
          onClick={() => {
            setText('')
            onClear()
          }}
        >
          {t('quotes.filters.clear')}
        </Button>
      )}
    </div>
  )
}
