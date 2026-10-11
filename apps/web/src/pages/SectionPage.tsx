import { useTranslation } from 'react-i18next'

/** Placeholder until the section's real screen is built. */
export function SectionPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation()
  return (
    <section>
      <h1 className="mb-2 text-2xl font-semibold">{t(titleKey)}</h1>
      <p className="text-muted-foreground">{t('pages.comingSoon')}</p>
    </section>
  )
}
