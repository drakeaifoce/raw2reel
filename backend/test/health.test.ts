import { describe, expect, test } from 'bun:test'
import { readiness } from '../src/health'

describe('readiness', () => {
  test('без настроенных зависимостей сервис считается готовым', async () => {
    const result = await readiness()
    expect(result.ready).toBe(true)
    expect(Object.keys(result.dependencies).sort()).toEqual(['blob', 'mongo'])
  })

  test('каждая зависимость сообщает своё состояние', async () => {
    const result = await readiness()
    for (const dependency of Object.values(result.dependencies)) {
      expect(['ok', 'unconfigured', 'error']).toContain(dependency.state)
    }
  })
})
