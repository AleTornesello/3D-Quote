import { useState } from 'react'
import { FormField } from '@/components/FormField'
import { Input } from '@/components/ui/input'
import { toAppError } from '@/data/errors'

/**
 * A text field that saves on blur or Enter when the text changed; Escape puts the saved value back. While the user
 * isn't editing it shows `value`, so a refetch updates it. `validate` returns an i18n key or null.
 */
export function InlineField({
  id,
  label,
  value,
  validate,
  onSave,
  disabled,
  inputMode,
  revertOnError = false,
}: {
  id: string
  label: string
  value: string
  validate: (text: string) => string | null
  onSave: (text: string) => Promise<unknown>
  disabled?: boolean
  inputMode?: 'decimal' | 'numeric' | 'text'
  revertOnError?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function commit() {
    // Enter commits and clears the draft, so the blur that follows finds nothing to save.
    if (draft === null) return
    const problem = validate(draft)
    if (problem) {
      setError(problem)
      if (revertOnError) setDraft(null)
      return
    }
    setError(null)
    setDraft(null)
    if (draft.trim() === value.trim()) return
    try {
      await onSave(draft)
    } catch (caught) {
      setError(toAppError(caught).messageKey)
    }
  }

  return (
    <FormField id={id} label={label} error={error ?? undefined}>
      <Input
        id={id}
        value={draft ?? value}
        inputMode={inputMode}
        disabled={disabled}
        aria-invalid={!!error}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void commit()
          } else if (event.key === 'Escape') {
            setDraft(null)
            setError(null)
          }
        }}
      />
    </FormField>
  )
}
