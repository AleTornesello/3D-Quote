import type { ClientOption } from '@/data/clients'

export function clientLabel(client: ClientOption) {
  return client.company ? `${client.name} (${client.company})` : client.name
}
