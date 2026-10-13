import type { TFunction } from 'i18next'
import type { Material } from '@/data/materials'
import type { ClientOption } from '@/data/clients'

export function clientLabel(client: ClientOption) {
  return client.company ? `${client.name} (${client.company})` : client.name
}

/** "Prusament PLA (PLA, Black)". */
export function materialLabel(material: Material, t: TFunction) {
  const type = material.type === 'other' ? t('materials.types.other') : material.type
  return `${material.name} (${[type, material.color].filter(Boolean).join(', ')})`
}
