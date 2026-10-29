import { useState, type FormEvent } from 'react'
import { authClient, identityClient } from '@/shared/api'
import { Button } from '@/shared/ui/button'
import { TextField } from '@/shared/ui/text-field'
import styles from './GuestRegistration.module.css'

export function GuestRegistration() {
  const { data: session } = authClient.useSession()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  if (!session?.user.isAnonymous) return null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMessage('')
    const form = new FormData(event.currentTarget)
    try {
      const response = await identityClient.signUp({
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        upgrade: true,
      })
      setMessage(
        response.status === 202
          ? 'Account creation started. Your uploads will stay with the new account.'
          : 'Account could not be created. Try again.',
      )
    } catch {
      setMessage('Account could not be created. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="keep-work-title">
      <h2 id="keep-work-title">Keep your work</h2>
      <p>Register this guest session to keep access to its uploads.</p>
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <TextField label="Name" name="name" required autoComplete="name" />
        <TextField label="Email" name="email" type="email" required autoComplete="email" />
        <TextField
          label="Password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      {message && <output>{message}</output>}
    </section>
  )
}
