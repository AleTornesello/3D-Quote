import { Menu } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Navigation } from './Navigation'

/** Fixed sidebar from 1024 px; below that a top bar opens the same navigation in a drawer. */
export function AppShell() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r lg:sticky lg:top-0 lg:block lg:h-svh lg:overflow-y-auto">
        <Navigation />
      </aside>
      <header className="flex items-center gap-2 border-b p-2 lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="size-11" aria-label={t('nav.menu')}>
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0" closeLabel={t('nav.close')}>
            <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
            <Navigation onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <span className="font-semibold">{t('app.name')}</span>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  )
}
