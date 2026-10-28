import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { routes } from '@/shared/config'
import { Button, buttonVariants } from '@/shared/ui/button'
import { Divider } from '@/shared/ui/divider'
import { ArrowRightIcon } from '@/shared/ui/icon'
import { TextField } from '@/shared/ui/text-field'
import styles from './SignInForm.module.css'

/** Guest entry plus a mock email sign-in — both lead straight to the studio. */
export function SignInForm() {
  const navigate = useNavigate()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Auth is mocked for the hackathon: any credentials open the studio.
    void navigate(routes.studio)
  }

  return (
    <section aria-labelledby="sign-in-title" className={styles.card}>
      <div className={styles.heading}>
        <h2 id="sign-in-title" className={styles.title}>
          Start editing
        </h2>
        <p className={styles.subtitle}>No account needed for the demo.</p>
      </div>

      <Link to={routes.studio} className={buttonVariants({ variant: 'primary', size: 'xl' })}>
        Continue as guest
        <ArrowRightIcon size={18} />
      </Link>

      <Divider>or sign in</Divider>

      <form className={styles.form} onSubmit={handleSubmit}>
        <TextField label="Email" type="email" placeholder="you@studio.com" autoComplete="email" />
        <TextField
          label="Password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
        />
        <Button type="submit" size="md">
          Sign in
        </Button>
      </form>

      <p className={styles.note}>
        Sign-in is a mockup for the hackathon. Guest mode has every feature.
      </p>
    </section>
  )
}
