import { ChevronsUpDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useClients, type ClientOption } from '@/data/clients'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { ClientSheet } from '../clients/ClientSheet'
import { clientLabel } from './labels'

/** Searches clients on the server; the last option creates a new client and selects it. */
export function ClientPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string
  value: ClientOption | null
  onChange: (client: ClientOption) => void
  invalid?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const clients = useClients(debounced)
  const [creating, setCreating] = useState(false)

  function pick(client: ClientOption) {
    onChange({ id: client.id, name: client.name, company: client.company })
    setOpen(false)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid}
            className="w-full justify-between font-normal"
          >
            {value ? (
              clientLabel(value)
            ) : (
              <span className="text-muted-foreground">{t('quotes.form.chooseClient')}</span>
            )}
            <ChevronsUpDown aria-hidden className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          {/* cmdk labels its input through the Command's `label`. */}
          <Command shouldFilter={false} label={t('quotes.form.clientSearch')}>
            <CommandInput
              placeholder={t('quotes.form.clientSearch')}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {clients.isPending && (
                <p role="status" className="p-3 text-sm text-muted-foreground">
                  {t('common.loading')}
                </p>
              )}
              {clients.data?.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">{t('quotes.form.noClients')}</p>
              )}
              {clients.data && clients.data.length > 0 && (
                <CommandGroup>
                  {clients.data.map((client) => (
                    <CommandItem
                      key={client.id}
                      value={String(client.id)}
                      onSelect={() => pick(client)}
                    >
                      {clientLabel(client)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="new-client"
                  onSelect={() => {
                    setOpen(false)
                    setCreating(true)
                  }}
                >
                  <Plus aria-hidden />
                  {t('quotes.form.newClient')}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {creating && (
        <ClientSheet
          onClose={() => setCreating(false)}
          onCreated={(client) => {
            pick(client)
            setCreating(false)
          }}
        />
      )}
    </>
  )
}
