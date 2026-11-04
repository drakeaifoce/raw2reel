/**
 * Возврат застрявших задач в оборот.
 *
 * Очередь сама переотдаёт сообщение, если воркер умер: это её работа. Но
 * бывает, что сообщения уже нет, а запись осталась незакрытой — ack прошёл,
 * а обновление не записалось; исчерпан max_deliver; процесс убит между
 * вызовами. Такая задача висит в rendering навсегда, и для пользователя это
 * выглядит бесконечной загрузкой.
 *
 * Публиковать повторно безопасно: msgID не даст второго сообщения, а claim
 * не возьмёт уже завершённую задачу.
 */
import type { RenderQueue } from './queue'
import type { RenderJobRepository } from './render-jobs'

/**
 * Сколько задача может не двигаться, прежде чем считать её застрявшей.
 * Вдвое больше самого долгого наблюдавшегося рендера (11 минут), чтобы не
 * трогать ту, что просто долго считается.
 */
export const STALE_AFTER_MS = 25 * 60_000

/** После суток задача безнадёжна: крутить её по кругу незачем. */
export const GIVE_UP_AFTER_MS = 24 * 60 * 60_000

/** За один проход — не больше, чтобы не захлебнуться на редком всплеске. */
const BATCH = 20

export type SweepResult = { requeued: number; failed: number }

export async function sweepStuckJobs(
  jobs: RenderJobRepository,
  queue: RenderQueue,
  now = () => Date.now(),
): Promise<SweepResult> {
  const moment = now()
  const stale = await jobs.stale(new Date(moment - STALE_AFTER_MS).toISOString(), BATCH)
  const result: SweepResult = { requeued: 0, failed: 0 }

  for (const job of stale) {
    const age = moment - Date.parse(job.updatedAt)
    if (age >= GIVE_UP_AFTER_MS) {
      await jobs.fail(job.id, `задача не двигалась больше суток (${Math.round(age / 3_600_000)} ч)`)
      result.failed += 1
      continue
    }
    try {
      await queue.publish(job.id)
      result.requeued += 1
    } catch (error) {
      // Очередь недоступна — не наша забота прямо сейчас: следующий проход
      // попробует снова, а задачу портить незачем.
      console.warn(`не удалось вернуть задачу ${job.id} в очередь`, error)
    }
  }
  return result
}
