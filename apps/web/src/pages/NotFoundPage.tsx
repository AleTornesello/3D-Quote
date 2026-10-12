import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

/** The not-found text. NotFoundPage wraps it for unknown URLs; detail pages show it for missing records. */
export function NotFoundMessage() {
  const { t } = useTranslation()
  return (
    <section>
      <h1 className="mb-2 text-2xl font-semibold">{t('pages.notFound.title')}</h1>
      <p className="mb-4 text-muted-foreground">{t('pages.notFound.body')}</p>
      <Link to="/quotes" className="underline-offset-4 hover:underline">
        {t('pages.notFound.back')}
      </Link>
    </section>
  )
}

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-lg p-6">
      <NotFoundMessage />
    </main>
  )
}
