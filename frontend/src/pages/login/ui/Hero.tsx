import { Eyebrow } from '@/shared/ui/eyebrow'
import styles from './Hero.module.css'

const STEPS = [
  'Upload one raw video or pick a sample',
  'SAM 3.1 finds every person, and you choose who stays in frame',
  'Add a soundtrack, and the cuts land on its beats',
  'Muse Spark picks the moments, Muse Voice captions the speech',
  'Get a reframed, captioned 9:16 reel',
]

export function Hero() {
  return (
    <section className={styles.hero}>
      <Eyebrow wide>AI edit co-pilot for Reels &amp; TikTok</Eyebrow>
      <h1 className={styles.title}>
        Drop the raw footage.
        <br />
        Get the reel.
      </h1>
      <p className={styles.lead}>
        Upload a raw media dump. Raw2Reel finds the best moments, keeps your people in frame,
        captions the speech and cuts it all to the beat.
      </p>
      <ol className={styles.steps}>
        {STEPS.map((step, i) => (
          <li key={step} className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <p className={styles.poweredBy}>Powered by SAM 3.1 · Muse Spark · Muse Voice Transcribe</p>
    </section>
  )
}
