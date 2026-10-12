import { FileText, Layers, Printer, Settings, UserCog, Users, type LucideIcon } from 'lucide-react'

/** Sidebar sections, in order (functional analysis §2). `ownerOnly` sections are hidden from operators. */
export const SECTIONS: { path: string; labelKey: string; icon: LucideIcon; ownerOnly?: boolean }[] =
  [
    { path: '/quotes', labelKey: 'nav.quotes', icon: FileText },
    { path: '/clients', labelKey: 'nav.clients', icon: Users },
    { path: '/printers', labelKey: 'nav.printers', icon: Printer },
    { path: '/materials', labelKey: 'nav.materials', icon: Layers },
    { path: '/settings', labelKey: 'nav.settings', icon: Settings },
    { path: '/staff', labelKey: 'nav.staff', icon: UserCog, ownerOnly: true },
  ]
