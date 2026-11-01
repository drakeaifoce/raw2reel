/**
 * Очередь задач рендера на NATS JetStream.
 *
 * Почему именно JetStream, а не обычный pub/sub: задача живёт минуты, и её
 * нельзя терять при перезапуске воркера. Почему вообще очередь, а не
 * синхронный вызов: в AI-сервисе глобальный render_lock, он рендерит по
 * одному и на параллельный запрос отвечает 429 — синхронный вызов держал бы
 * HTTP-запрос десять минут и отказывал второму пользователю.
 */
import { AckPolicy, connect, type NatsConnection } from 'nats'
import type { Config } from './config'

const STREAM = 'RENDER'
const SUBJECT = 'render.jobs'
const DURABLE = 'render-worker'

/** Исход обработки: от него зависит, что сделать с сообщением. */
export type QueueOutcome =
  /** Готово — подтверждаем, сообщение уходит из очереди. */
  | 'done'
  /** AI-сервис занят — возвращаем с задержкой, попытка не тратится зря. */
  | 'retry-later'
  /** Безнадёжно — снимаем с доставки, повторять бессмысленно. */
  | 'failed'

export interface RenderQueue {
  publish(jobId: string): Promise<void>
  consume(handler: (jobId: string) => Promise<QueueOutcome>): Promise<void>
  ping(): Promise<void>
  close(): Promise<void>
}

export class NatsRenderQueue implements RenderQueue {
  private constructor(private readonly nc: NatsConnection) {}

  static async connect(url: string): Promise<NatsRenderQueue> {
    const nc = await connect({ servers: url, name: 'raw2reel', timeout: 10_000 })
    const jsm = await nc.jetstreamManager()
    // Идемпотентно: при повторном запуске поток уже есть.
    await jsm.streams.add({ name: STREAM, subjects: [`${SUBJECT}.>`, SUBJECT] }).catch(() => {})
    await jsm.consumers
      .add(STREAM, {
        durable_name: DURABLE,
        ack_policy: AckPolicy.Explicit,
        // Четыре повтора: дальше задача помечается провалившейся, чтобы она не
        // циклилась вечно и пользователь увидел внятный отказ.
        max_deliver: 5,
        ack_wait: 15 * 60 * 1_000_000_000,
      })
      .catch(() => {})
    return new NatsRenderQueue(nc)
  }

  async publish(jobId: string): Promise<void> {
    // msgID даёт дедупликацию на стороне JetStream: повторная публикация той
    // же задачи не создаёт второго сообщения.
    await this.nc.jetstream().publish(SUBJECT, new TextEncoder().encode(jobId), { msgID: jobId })
  }

  async consume(handler: (jobId: string) => Promise<QueueOutcome>): Promise<void> {
    const consumer = await this.nc.jetstream().consumers.get(STREAM, DURABLE)
    for (;;) {
      // По одному сообщению за раз: больше смысла нет, в AI-сервисе один слот.
      const messages = await consumer.fetch({ max_messages: 1, expires: 30_000 })
      for await (const message of messages) {
        const jobId = message.string()
        let outcome: QueueOutcome = 'failed'
        try {
          outcome = await handler(jobId)
        } catch (error) {
          console.error(`задача ${jobId}: необработанная ошибка`, error)
          outcome = 'retry-later'
        }
        if (outcome === 'done') message.ack()
        else if (outcome === 'retry-later') message.nak(10_000)
        else message.term()
      }
    }
  }

  async ping(): Promise<void> {
    await this.nc.jetstreamManager()
  }

  async close(): Promise<void> {
    await this.nc.drain()
  }
}

export async function createRenderQueue(config: Config): Promise<RenderQueue | undefined> {
  if (!config.natsUrl) return undefined
  return NatsRenderQueue.connect(config.natsUrl)
}

/**
 * Лёгкая проверка для /ready: только соединение, без создания потока и
 * получателя. Поднимать их на каждый опрос готовности незачем.
 */
export async function pingQueue(url: string): Promise<void> {
  const nc = await connect({ servers: url, name: 'raw2reel-ready', timeout: 5_000 })
  try {
    await nc.flush()
  } finally {
    await nc.close()
  }
}
