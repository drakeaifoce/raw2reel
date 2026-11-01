/**
 * Воркер рендера: отдельный процесс и отдельный контейнер из того же образа,
 * что и бэкенд. Отдельный — потому что рендер занимает минуты, и делить
 * процесс с HTTP-сервером незачем. Конкурентность одна: в AI-сервисе
 * глобальный render_lock, больше одного слота всё равно нет.
 */
import { createAiClient } from './ai-client'
import { config } from './config'
import { createMediaService } from './media'
import type { QueueOutcome } from './queue'
import { createRenderQueue } from './queue'
import { createRenderJobService } from './render-jobs'

const media = createMediaService(config)
const jobs = createRenderJobService(config)
const ai = createAiClient(config)

const missing = [
  !media && 'хранилище медиа (MONGO_URL, AZURE_STORAGE_CONNECTION_STRING)',
  !jobs && 'хранилище задач (MONGO_URL)',
  !ai && 'клиент AI-сервиса (AI_SERVICE_URL, AI_SERVICE_TOKEN)',
  !config.natsUrl && 'очередь (NATS_URL)',
].filter(Boolean)

if (missing.length > 0) {
  console.error(`воркер не настроен, не хватает: ${missing.join('; ')}`)
  process.exit(1)
}

const queue = await createRenderQueue(config)
if (!queue) {
  console.error('не удалось подключиться к очереди')
  process.exit(1)
}

console.log(`воркер ${config.version} подключён к очереди, слот один`)

const handle = async (jobId: string): Promise<QueueOutcome> => {
  const job = await jobs!.claim(jobId)
  if (!job) {
    // Задача уже завершена: это повторная доставка, переделывать нечего.
    console.log(`задача ${jobId}: уже завершена, подтверждаю`)
    return 'done'
  }

  const source = await media!.get(job.sourceMediaId, job.ownerId)
  if (!source) {
    await jobs!.fail(jobId, 'исходное видео не найдено или недоступно владельцу')
    return 'failed'
  }
  const music = job.musicMediaId ? await media!.get(job.musicMediaId, job.ownerId) : null
  if (job.musicMediaId && !music) {
    await jobs!.fail(jobId, 'музыка не найдена или недоступна владельцу')
    return 'failed'
  }

  console.log(`задача ${jobId}: рендер начат, попытка ${job.attempts}`)
  const outcome = await ai!.render({
    video: { name: source.metadata.name, type: source.metadata.type, body: source.body },
    ...(music
      ? {
          music: {
            name: music.metadata.name,
            type: music.metadata.type,
            body: music.body,
          },
        }
      : {}),
    duration: job.duration,
    captions: job.captions,
  })

  if (outcome.status === 'busy') {
    await jobs!.requeue(jobId)
    console.log(`задача ${jobId}: AI-сервис занят, вернул в очередь`)
    return 'retry-later'
  }
  if (outcome.status === 'unavailable') {
    await jobs!.requeue(jobId)
    console.warn(`задача ${jobId}: AI-сервис недоступен — ${outcome.detail}`)
    return 'retry-later'
  }
  if (outcome.status === 'rejected') {
    await jobs!.fail(jobId, outcome.detail || 'AI-сервис отверг медиа или параметры')
    return 'failed'
  }

  // Результат буферизуем осознанно: это готовый рилс до 30 секунд, единицы
  // мегабайт. Исходник, который может быть 150 MB, в память не попадает —
  // он уходит в AI-сервис потоком.
  const blob = await new Response(outcome.body).blob()
  const file = new File([blob], `reel-${jobId}.mp4`, { type: 'video/mp4' })
  const stored = await media!.create(file, job.ownerId)
  await jobs!.finish(jobId, stored.id)
  console.log(`задача ${jobId}: готово, медиа ${stored.id}, ${blob.size} байт`)
  return 'done'
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal}: закрываю очередь`)
    queue.close().finally(() => process.exit(0))
  })
}

await queue.consume(handle)
