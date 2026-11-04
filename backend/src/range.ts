/**
 * Разбор заголовка Range (RFC 7233) для отдачи медиа по частям.
 *
 * Вынесено отдельно от маршрутов: это единственное место с арифметикой
 * границ, и проверять её дешевле прямыми тестами, чем через HTTP.
 */

/** Отрезок включительно с обеих сторон, как и в самом заголовке. */
export type ByteRange = { start: number; end: number }

export type RangeRequest =
  /** Заголовка нет или он не про байты — отдаём файл целиком. */
  | { kind: 'full' }
  /** Запрошенный отрезок, уже обрезанный по размеру файла. */
  | { kind: 'partial'; range: ByteRange }
  /** Начало за концом файла: по спецификации это 416, а не отдача целиком. */
  | { kind: 'unsatisfiable' }

const SINGLE = /^bytes=(\d*)-(\d*)$/

/**
 * `size` — настоящий размер файла. Ноль допустим: у пустого файла любой
 * отрезок неудовлетворим.
 */
export function parseRange(header: string | null, size: number): RangeRequest {
  if (!header) return { kind: 'full' }
  const match = SINGLE.exec(header.trim())
  // Несколько диапазонов через запятую не поддерживаем: спецификация
  // разрешает ответить целым файлом, а multipart/byteranges ради перемотки
  // в плеере не нужен — браузеры запрашивают по одному отрезку.
  if (!match) return { kind: 'full' }

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return { kind: 'full' }
  if (size <= 0) return { kind: 'unsatisfiable' }

  let start: number
  let end: number
  if (!rawStart) {
    // `bytes=-500` — последние 500 байт, а не «от начала до 500».
    const length = Number(rawEnd)
    if (length <= 0) return { kind: 'unsatisfiable' }
    start = Math.max(0, size - length)
    end = size - 1
  } else {
    start = Number(rawStart)
    if (start >= size) return { kind: 'unsatisfiable' }
    // Конец за пределом файла обрезается молча — так требует спецификация.
    end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1
    if (end < start) return { kind: 'unsatisfiable' }
  }
  return { kind: 'partial', range: { start, end } }
}

/** Значение заголовка Content-Range для успешной частичной отдачи. */
export const contentRange = ({ start, end }: ByteRange, size: number) =>
  `bytes ${start}-${end}/${size}`

/** Content-Range для ответа 416: клиенту сообщается настоящий размер. */
export const unsatisfiableRange = (size: number) => `bytes */${size}`
