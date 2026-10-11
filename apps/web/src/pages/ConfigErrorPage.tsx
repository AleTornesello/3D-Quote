import { useTranslation } from 'react-i18next'

export function ConfigErrorPage({ missing }: { missing: string[] }) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="mb-2 text-2xl font-semibold">{t('config.title')}</h1>
      <p className="mb-4 text-muted-foreground">{t('config.body')}</p>
      <p className="font-medium">{t('config.missing')}</p>
      <ul className="list-disc pl-6 font-mono text-sm">
        {missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </main>
  )
}
