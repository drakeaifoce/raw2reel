/**
 * Создание индексов, устойчивое к особенности Cosmos.
 *
 * В настоящей MongoDB повторный createIndex идемпотентен. Mongo-совместимый
 * API Cosmos на гонке двух процессов бросает NamespaceExists («коллекция уже
 * существует»), и сервис падает на старте. С появлением воркера таких
 * процессов стало два: он и бэкенд поднимаются одновременно и создают одни и
 * те же индексы.
 *
 * 48 — NamespaceExists, 85 и 86 — конфликты описания уже существующего
 * индекса. Всё это означает «нужное уже есть», и падать тут не на чем.
 */
const ALREADY_PRESENT = new Set([48, 85, 86])

export const ensureIndexes = (tasks: Promise<unknown>[]): Promise<unknown> =>
  Promise.all(
    tasks.map((task) =>
      task.catch((error: unknown) => {
        const code = (error as { code?: number } | null)?.code
        if (typeof code === 'number' && ALREADY_PRESENT.has(code)) return
        throw error
      }),
    ),
  )
