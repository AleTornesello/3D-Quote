import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageSwitcher } from '@/layout/LanguageSwitcher'
import { useSupabase } from '@/lib/supabase'

export function LoginPage() {
  const { t } = useTranslation()
  const supabase = useSupabase()
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [failed, setFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const from = (location.state as { from?: string } | null)?.from ?? '/quotes'

  if (auth.status === 'signedIn') return <Navigate to={from} replace />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setFailed(false)
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    setSubmitting(false)
    if (error) setFailed(true)
    else navigate(from, { replace: true })
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold">{t('auth.login.title')}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">{t('auth.login.email')}</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t('auth.login.password')}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {failed && (
              <p role="alert" className="text-sm text-destructive">
                {t('auth.login.error')}
              </p>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
            </Button>
            <Link to="/forgot-password" className="text-sm underline-offset-4 hover:underline">
              {t('auth.login.forgot')}
            </Link>
          </form>
          <div className="mt-6">
            <LanguageSwitcher />
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
