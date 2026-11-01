/**
 * Воркер: отдельный процесс и отдельный контейнер из того же образа, что и
 * бэкенд. Отдельный — потому что работа занимает минуты, и делить процесс с
 * HTTP-сервером незачем. Конкурентность одна: в AI-сервисе один замок на
 * prepare и render, больше одного слота всё равно нет.
 *
 * Работы две. Prepare по видео собирает каталог персонажей — его показывают
 * пользователю. Render по каталогу и выбранным персонажам собирает ролик.
 * Если клиент прислал только видео, воркер делает оба шага подряд и выбирает
 * персонажей сам.
 */
import { createAiClient } from './ai-client'
import { createAnalysisService, type AnalysisRecord } from './analyses'
import { config } from './config'
import { createMediaService } from './media'
import type { QueueOutcome } from './queue'
import { MAX_DELIVERIES, createRenderQueue } from './queue'
import { createRenderJobService, type RenderJob } from './render-jobs'

const media = createMediaService(config)
const jobs = createRenderJobService(config)
const analyses = createAnalysisService(config)
const ai = createAiClient(config)

const missing = [
  !media && 'хранилище медиа (MONGO_URL, AZURE_STORAGE_CONNECTION_STRING)',
  !jobs && 'хранилище задач (MONGO_URL)',
  !analyses && 'хранилище разборов (MONGO_URL, AZURE_STORAGE_CONNECTION_STRING)',
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

/** Предел AI-сервиса: больше шестнадцати персонажей он не примет. */
const MAX_PEOPLE = 16

/** Шаг либо дал результат, либо уже решил судьбу сообщения в очереди. */
type Step<T> = { value: T } | { outcome: QueueOutcome }

/** Безнадёжный отказ: повторять бессмысленно. */
const abort = async (
  job: RenderJob,
  message: string,
  alsoFail?: (message: string) => Promise<void>,
): Promise<QueueOutcome> => {
  await jobs!.fail(job.id, message)
  await alsoFail?.(message)
  console.error(`задача ${job.id}: ${message}`)
  return 'failed'
}

/** Отказ, который может пройти позже: возвращаем в очередь, пока есть попытки. */
const postpone = async (
  job: RenderJob,
  reason: string,
  alsoFail?: (message: string) => Promise<void>,
): Promise<QueueOutcome> => {
  // Попытки кончились: сдаёмся явно. Иначе очередь просто перестанет
  // доставлять, а задача навсегда останется в queued и будет выглядеть как
  // ожидающая своей очереди.
  if (job.attempts >= MAX_DELIVERIES) {
    const message = `исчерпаны попытки (${job.attempts}): ${reason}`
    await jobs!.fail(job.id, message)
    await alsoFail?.(message)
    console.error(`задача ${job.id}: исчерпаны попытки — ${reason}`)
    return 'failed'
  }
  await jobs!.requeue(job.id)
  console.warn(`задача ${job.id}: попытка ${job.attempts} не удалась — ${reason}`)
  return 'retry-later'
}

/** Шаг prepare: видео уходит в сервис, ответ раскладывается по хранилищу. */
const prepareAnalysis = async (
  job: RenderJob,
  record: AnalysisRecord,
): Promise<Step<AnalysisRecord>> => {
  const markFailed = (message: string) => analyses!.fail(record.id, message)
  const source = await media!.get(record.sourceMediaId, record.ownerId)
  if (!source) {
    return { outcome: await abort(job, 'исходное видео не найдено или недоступно', markFailed) }
  }

  console.log(`задача ${job.id}: разбор ${record.id} начат, попытка ${job.attempts}`)
  const outcome = await ai!.prepare({
    video: { name: source.metadata.name, type: source.metadata.type, body: source.body },
  })
  if (outcome.status === 'busy' || outcome.status === 'unavailable') {
    const reason = outcome.status === 'busy' ? 'AI-сервис занят другой работой' : outcome.detail
    return { outcome: await postpone(job, reason, markFailed) }
  }
  if (outcome.status === 'rejected') {
    return {
      outcome: await abort(job, outcome.detail || 'AI-сервис отверг исходник', markFailed),
    }
  }

  // Ответ буферизуем осознанно: сервис сам ограничивает его 16 MB, а у
  // воркера памяти 512 MB. Исходник, который может быть 150 MB, в память не
  // попадает — он уходит потоком.
  const prepared = new Uint8Array(await new Response(outcome.body).arrayBuffer())
  try {
    return { value: await analyses!.finish(record.id, prepared) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { outcome: await abort(job, `ответ prepare непригоден: ${detail}`, markFailed) }
  }
}

const runPrepare = async (job: RenderJob): Promise<QueueOutcome> => {
  if (!job.analysisId) return abort(job, 'задача разбора без идентификатора разбора')
  const analysisId = job.analysisId
  const claimed = await analyses!.claim(analysisId)
  if (!claimed) {
    // Разбор уже завершён: это повторная доставка. Состояние задачи приводим в
    // соответствие с разбором, чтобы она не осталась в работе навсегда.
    const existing = await analyses!.get(analysisId, job.ownerId)
    if (existing?.status === 'failed') {
      await jobs!.fail(job.id, existing.error ?? 'разбор не удался')
    } else {
      await jobs!.finish(job.id)
    }
    console.log(`задача ${job.id}: разбор ${analysisId} уже завершён, подтверждаю`)
    return 'done'
  }

  const step = await prepareAnalysis(job, claimed)
  if ('outcome' in step) return step.outcome
  await jobs!.finish(job.id)
  console.log(`задача ${job.id}: разбор готов, персонажей ${step.value.people.length}`)
  return 'done'
}

const runRender = async (job: RenderJob): Promise<QueueOutcome> => {
  let record: AnalysisRecord | null
  if (job.analysisId) {
    record = await analyses!.get(job.analysisId, job.ownerId)
    if (!record) return abort(job, 'разбор не найден или недоступен владельцу')
    if (record.status !== 'done') return abort(job, `разбор не готов (${record.status})`)
  } else {
    // Готовый разбор того же исходника переиспользуем: модели платные.
    // Незавершённый — тоже: иначе каждая повторная доставка начинала бы новый
    // разбор и оставляла за собой брошенные записи.
    record =
      (await analyses!.latestDone(job.ownerId, job.sourceMediaId)) ??
      (await analyses!.latestPending(job.ownerId, job.sourceMediaId)) ??
      (await analyses!.create({
        id: crypto.randomUUID(),
        ownerId: job.ownerId,
        sourceMediaId: job.sourceMediaId,
      }))
    if (record.status !== 'done') {
      const claimed = await analyses!.claim(record.id)
      if (!claimed) {
        // Разбор завершился помимо нас: перечитываем, чтобы не рендерить по
        // пустой записи.
        const fresh = await analyses!.get(record.id, job.ownerId)
        if (!fresh || fresh.status !== 'done') {
          return abort(job, `разбор не удался: ${fresh?.error ?? 'состояние неизвестно'}`)
        }
        record = fresh
      } else {
        const step = await prepareAnalysis(job, claimed)
        if ('outcome' in step) return step.outcome
        record = step.value
      }
    }
  }

  if (record.people.length === 0) {
    // Пустой person_ids сервис не принимает, поэтому говорим прямо, а не ждём
    // отказа на рендере.
    return abort(job, 'в исходнике не найдено ни одного персонажа: выбирать некого')
  }
  const chosen =
    job.personIds && job.personIds.length > 0
      ? job.personIds
      : [...record.people]
          .sort((left, right) => right.observationCount - left.observationCount)
          .slice(0, MAX_PEOPLE)
          .map((person) => person.id)

  // Исходник берём из разбора, а не из задачи: сервис сверяет каталог с
  // отпечатком видео, и другой файл он отвергнет.
  const source = await media!.get(record.sourceMediaId, job.ownerId)
  if (!source) return abort(job, 'исходное видео не найдено или недоступно владельцу')
  const music = job.musicMediaId ? await media!.get(job.musicMediaId, job.ownerId) : null
  if (job.musicMediaId && !music) {
    await source.body.cancel()
    return abort(job, 'музыка не найдена или недоступна владельцу')
  }

  let analysis: Uint8Array
  try {
    analysis = await analyses!.readPrepared(record)
  } catch (error) {
    await source.body.cancel()
    await music?.body.cancel()
    const detail = error instanceof Error ? error.message : String(error)
    return postpone(job, `не удалось прочитать разбор: ${detail}`)
  }

  console.log(
    `задача ${job.id}: рендер начат, попытка ${job.attempts}, персонажей ${chosen.length}`,
  )
  const outcome = await ai!.render({
    video: { name: source.metadata.name, type: source.metadata.type, body: source.body },
    analysis,
    personIds: chosen,
    ...(music
      ? { music: { name: music.metadata.name, type: music.metadata.type, body: music.body } }
      : {}),
    // Значения по умолчанию те же, что в API: задача могла быть создана
    // цепочкой из рендера, где их не спрашивали.
    duration: job.duration ?? 27,
    captions: job.captions ?? true,
  })

  if (outcome.status === 'busy' || outcome.status === 'unavailable') {
    const reason = outcome.status === 'busy' ? 'AI-сервис занят другой работой' : outcome.detail
    return postpone(job, reason)
  }
  if (outcome.status === 'rejected') {
    return abort(job, outcome.detail || 'AI-сервис отверг медиа или параметры')
  }

  // Результат буферизуем осознанно: это готовый рилс до 30 секунд, единицы
  // мегабайт.
  const blob = await new Response(outcome.body).blob()
  const file = new File([blob], `reel-${job.id}.mp4`, { type: 'video/mp4' })
  const stored = await media!.create(file, job.ownerId)
  await jobs!.finish(job.id, stored.id)
  console.log(`задача ${job.id}: готово, медиа ${stored.id}, ${blob.size} байт`)
  return 'done'
}

const handle = async (jobId: string): Promise<QueueOutcome> => {
  const job = await jobs!.claim(jobId)
  if (!job) {
    // Задача уже завершена: это повторная доставка, переделывать нечего.
    console.log(`задача ${jobId}: уже завершена, подтверждаю`)
    return 'done'
  }
  // У записей, созданных до появления prepare, вида работы нет: это рендер.
  return (job.kind ?? 'render') === 'prepare' ? runPrepare(job) : runRender(job)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal}: закрываю очередь`)
    queue.close().finally(() => process.exit(0))
  })
}

await queue.consume(handle)
