import { SignInForm } from '@/features/sign-in'
import { AppHeader } from '@/widgets/app-header'
import { Hero } from './Hero'
import styles from './LoginPage.module.css'

export function LoginPage() {
  return (
    <div className={styles.page}>
      <AppHeader variant="landing" aside="Hackathon demo build" />
      <main className={styles.main}>
        <Hero />
        <SignInForm />
      </main>
    </div>
  )
}
