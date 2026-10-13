import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'

const VARIANT = {
  draft: 'secondary',
  sent: 'default',
  accepted: 'outline',
  rejected: 'destructive',
  expired: 'outline',
} as const

/** The status in words; the variant only adds emphasis. */
export function QuoteStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const variant = VARIANT[status as keyof typeof VARIANT] ?? 'secondary'
  return <Badge variant={variant}>{t(`quotes.status.${status}`)}</Badge>
}
