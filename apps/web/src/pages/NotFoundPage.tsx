import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="mb-2 text-2xl font-semibold">{t('pages.notFound.title')}</h1>
      <p className="mb-4 text-muted-foreground">{t('pages.notFound.body')}</p>
      <Link to="/quotes" className="underline-offset-4 hover:underline">
        {t('pages.notFound.back')}
      </Link>
    </main>
  )
}
