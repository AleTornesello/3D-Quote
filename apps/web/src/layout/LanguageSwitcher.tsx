import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, setLanguage, type Language } from '@/i18n'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const id = useId()
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        {t('language.label')}
      </label>
      <select
        id={id}
        value={i18n.language}
        onChange={(event) => void setLanguage(event.target.value as Language)}
        className="h-8 rounded-md border border-input bg-background px-2 pointer-coarse:h-11"
      >
        {LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {t(`language.${lng}`)}
          </option>
        ))}
      </select>
    </div>
  )
}
