import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { routes } from '@/shared/config'
import { identityClient } from '@/shared/api'
import { Button } from '@/shared/ui/button'
import { TextField } from '@/shared/ui/text-field'
import styles from './SignInForm.module.css'

export function SignInForm() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [pending, setPending] = useState(false)
  const [guestPending, setGuestPending] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    try {
      const result =
        mode === 'sign-in'
          ? await identityClient.signIn({ email, password })
          : await identityClient.signUp({
              email,
              password,
              name: String(form.get('name') ?? ''),
            })
      if (result.ok) {
        void navigate(routes.studio, { replace: true })
        return
      }
    } catch {
      // Network and server failures intentionally share the generic message below.
    } finally {
      setPending(false)
    }
    setError('Unable to authenticate. Check your details and try again.')
  }

  async function continueAsGuest() {
    setGuestPending(true)
    setError('')
    try {
      const result = await identityClient.startGuest()
      if (result.ok) {
        void navigate(routes.studio, { replace: true })
        return
      }
    } catch {
      // Keep dependency and transport details out of user-visible errors.
    }
    setError('Unable to start a guest session. Try again.')
    setGuestPending(false)
  }

  return (
    <section aria-labelledby="sign-in-title" className={styles.card}>
      <div className={styles.heading}>
        <h2 id="sign-in-title" className={styles.title}>
          Start editing
        </h2>
        <p className={styles.subtitle}>
          {mode === 'sign-in' ? 'Sign in to continue.' : 'Create an account to start editing.'}
        </p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        {mode === 'sign-up' && <TextField label="Name" name="name" required autoComplete="name" />}
        <TextField
          label="Email"
          name="email"
          type="email"
          required
          placeholder="you@studio.com"
          autoComplete="email"
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="••••••••"
          autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="md" disabled={pending}>
          {pending ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
      <div className={styles.guestSection}>
        <Button
          type="button"
          variant="primary"
          disabled={pending || guestPending}
          onClick={() => void continueAsGuest()}
        >
          {guestPending ? 'Starting guest session…' : 'Continue as guest'}
        </Button>
        <p className={styles.guestNote}>
          Guest work can be lost if you clear this browser session. Register to keep access.
        </p>
      </div>

      <p className={styles.note}>
        {mode === 'sign-in' ? 'New to Raw2Reel?' : 'Already have an account?'}{' '}
        <button
          className={styles.modeButton}
          type="button"
          onClick={() => {
            setError('')
            setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
          }}
        >
          {mode === 'sign-in' ? 'Create account' : 'Sign in'}
        </button>
      </p>
    </section>
  )
}
