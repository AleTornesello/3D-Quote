import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSupabase } from '@/lib/supabase'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const supabase = useSupabase()
  const [sent, setSent] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email'))
    // The result is deliberately ignored: the page never reveals whether an address exists.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/account?reset=1`,
    })
    setSent(true)
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">{t('auth.forgot.title')}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {sent ? (
            <p role="status">{t('auth.forgot.sent')}</p>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-4">
              <p className="text-sm text-muted-foreground">{t('auth.forgot.body')}</p>
              <div className="grid gap-2">
                <Label htmlFor="email">{t('auth.forgot.email')}</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              <Button type="submit">{t('auth.forgot.submit')}</Button>
            </form>
          )}
          <Link to="/login" className="text-sm underline-offset-4 hover:underline">
            {t('auth.forgot.back')}
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
