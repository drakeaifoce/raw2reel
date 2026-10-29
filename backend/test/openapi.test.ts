import type { OpenAPIV3_1 } from 'openapi-types'
import { expect, test } from 'bun:test'
import SwaggerParser from '@apidevtools/swagger-parser'
import { handle } from '../src/app'

test('public docs work behind strip-prefix and directly, with local assets', async () => {
  for (const prefix of ['', '/api']) {
    const proxy = (path: string) =>
      handle(new Request(`http://localhost${path.slice(prefix.length)}`), {})
    const docs = await proxy(`${prefix}/docs`)
    expect(docs.status).toBe(200)
    const html = await docs.text()
    expect(html).toContain('swagger-ui')
    expect(html).not.toContain('https://')
    const schema = await proxy(`${prefix}/openapi.json`)
    expect(schema.status).toBe(200)
    const document = (await schema.json()) as OpenAPIV3_1.Document
    expect(document.servers).toEqual([{ url: './' }])
    await SwaggerParser.validate(document)
    expect(
      (document.paths!['/media']!.post!.requestBody as OpenAPIV3_1.RequestBodyObject).content[
        'multipart/form-data'
      ],
    ).toBeDefined()
    expect(document.paths!['/identity/api/refresh']).toBeDefined()
    expect(document.paths!['/identity/web/refresh']).toBeDefined()
    expect(document.paths!['/auth/get-session']).toBeDefined()
    const js = await proxy(`${prefix}/docs/init.js`)
    expect(await js.text()).toContain('supportedSubmitMethods: []')
    expect((await proxy(`${prefix}/docs/swagger-ui-bundle.js`)).status).toBe(200)
  }
})

import savedAuthSchema from '../src/auth-schema.json'
import { authSchema } from '../scripts/auth-schema'

test('Better Auth session schema is regenerated from the installed configuration', async () => {
  expect(await authSchema()).toEqual(savedAuthSchema)
})

test('documented media authentication failure matches the actual response', async () => {
  const response = await handle(new Request('http://localhost/media'), {
    auth: { handler: async () => new Response(), getSession: async () => null },
  })
  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ error: 'authentication required', code: 'UNAUTHORIZED' })
})
