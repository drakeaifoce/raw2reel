/**
 * Выбор разбора для задачи рендера.
 *
 * Вынесено из воркера, чтобы это можно было проверить тестами: воркер — скрипт
 * с побочными действиями на уровне модуля, импортировать его в тест нельзя. А
 * проверять здесь есть что: на повторной доставке цепочечный рендер однажды
 * создавал новый разбор на каждую попытку и оставлял за собой брошенные записи.
 */
import type { AnalysisRecord, AnalysisRepository } from './analyses'

export type AnalysisChoice =
  /** Разбор готов, можно рендерить. */
  | { kind: 'ready'; record: AnalysisRecord }
  /** Разбор взят в работу — его ещё надо заполнить, обратившись к моделям. */
  | { kind: 'prepare'; record: AnalysisRecord }
  /** Рендерить нечего и не будет. */
  | { kind: 'failed'; reason: string }

export type AnalysisDemand = {
  ownerId: string
  sourceMediaId: string
  /** Разбор, выбранный клиентом. Если его нет, разбираем сами. */
  analysisId?: string
}

export async function resolveAnalysis(
  analyses: AnalysisRepository,
  demand: AnalysisDemand,
  newId: () => string = () => crypto.randomUUID(),
): Promise<AnalysisChoice> {
  if (demand.analysisId) {
    // Выбор клиента принимаем только готовым: API уже отвечает на неготовый
    // разбор 409, и молча доделывать его за клиента незачем.
    const record = await analyses.get(demand.analysisId, demand.ownerId)
    if (!record) return { kind: 'failed', reason: 'разбор не найден или недоступен владельцу' }
    if (record.status !== 'done') {
      return { kind: 'failed', reason: `разбор не готов (${record.status})` }
    }
    return { kind: 'ready', record }
  }

  // Готовый разбор того же исходника переиспользуем: модели платные.
  // Незавершённый — тоже: иначе каждая повторная доставка начинала бы новый.
  const existing =
    (await analyses.latestDone(demand.ownerId, demand.sourceMediaId)) ??
    (await analyses.latestPending(demand.ownerId, demand.sourceMediaId))
  if (existing?.status === 'done') return { kind: 'ready', record: existing }

  const record =
    existing ??
    (await analyses.create({
      id: newId(),
      ownerId: demand.ownerId,
      sourceMediaId: demand.sourceMediaId,
    }))

  const claimed = await analyses.claim(record.id)
  if (claimed) return { kind: 'prepare', record: claimed }

  // Разбор завершился помимо нас: перечитываем, чтобы не рендерить по пустой
  // записи и не начинать второй прогон моделей.
  const fresh = await analyses.get(record.id, demand.ownerId)
  if (fresh?.status === 'done') return { kind: 'ready', record: fresh }
  return { kind: 'failed', reason: `разбор не удался: ${fresh?.error ?? 'состояние неизвестно'}` }
}
