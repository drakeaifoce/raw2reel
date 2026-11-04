import { describe, expect, test } from 'bun:test'
import { contentRange, parseRange, unsatisfiableRange } from '../src/range'

const SIZE = 1000

describe('parseRange', () => {
  test('без заголовка отдаём файл целиком', () => {
    expect(parseRange(null, SIZE)).toEqual({ kind: 'full' })
  })

  test('обычный отрезок включает оба конца', () => {
    // 0-499 — это 500 байт, а не 499: границы включительные.
    expect(parseRange('bytes=0-499', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 499 },
    })
  })

  test('открытый справа тянется до конца файла', () => {
    expect(parseRange('bytes=500-', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 500, end: 999 },
    })
  })

  test('суффиксный отрезок — последние байты, а не первые', () => {
    expect(parseRange('bytes=-200', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 800, end: 999 },
    })
  })

  test('суффикс длиннее файла даёт файл целиком, а не отрицательное начало', () => {
    expect(parseRange('bytes=-5000', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 999 },
    })
  })

  test('конец за пределом файла молча обрезается', () => {
    expect(parseRange('bytes=900-5000', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 900, end: 999 },
    })
  })

  test('начало за концом файла — 416, а не тихая отдача целиком', () => {
    // Иначе плеер считает перемотку удавшейся и показывает не то место.
    expect(parseRange('bytes=1000-', SIZE)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=5000-6000', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  test('перевёрнутый отрезок неудовлетворим', () => {
    expect(parseRange('bytes=500-100', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  test('у пустого файла любой отрезок неудовлетворим', () => {
    expect(parseRange('bytes=0-10', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  test('нулевой суффикс неудовлетворим: ноль байт отдать нельзя', () => {
    expect(parseRange('bytes=-0', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  test('последний байт запрашивается без ошибки на границе', () => {
    expect(parseRange('bytes=999-999', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 999, end: 999 },
    })
  })

  test('чужие единицы и мусор игнорируем, отдавая целиком', () => {
    for (const header of ['items=0-10', 'bytes=abc-def', 'bytes=', 'bytes=-', '']) {
      expect(parseRange(header, SIZE)).toEqual({ kind: 'full' })
    }
  })

  test('несколько диапазонов не поддерживаем — отдаём целиком', () => {
    // Спецификация это разрешает, а multipart/byteranges ради перемотки
    // не нужен: браузеры запрашивают по одному отрезку.
    expect(parseRange('bytes=0-99,200-299', SIZE)).toEqual({ kind: 'full' })
  })

  test('пробелы вокруг заголовка не мешают', () => {
    expect(parseRange('  bytes=0-9  ', SIZE)).toEqual({
      kind: 'partial',
      range: { start: 0, end: 9 },
    })
  })
})

describe('заголовки ответа', () => {
  test('Content-Range показывает отрезок и полный размер', () => {
    expect(contentRange({ start: 0, end: 499 }, SIZE)).toBe('bytes 0-499/1000')
  })

  test('при 416 сообщаем настоящий размер файла', () => {
    expect(unsatisfiableRange(SIZE)).toBe('bytes */1000')
  })
})
