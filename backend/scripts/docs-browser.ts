import { strict as assert } from 'node:assert'
import { chromium } from 'playwright'
import { handle } from '../src/app'

// Isolated backend and prefix-stripping proxy, with no storage or auth services.
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) url.pathname = url.pathname.slice(4)
    return handle(new Request(url, request), {})
  },
})

try {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const path of ['/docs', '/docs/', '/api/docs', '/api/docs/']) {
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        const errors: string[] = []
        const responses: { path: string; status: number }[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => {
          if (['error', 'warning'].includes(message.type())) errors.push(message.text())
        })
        page.on('requestfailed', (request) => errors.push(`Failed request: ${request.url()}`))
        page.on('response', (response) => {
          const url = new URL(response.url())
          responses.push({ path: url.pathname, status: response.status() })
          if (url.origin !== server.url.origin || response.status() >= 400) {
            errors.push(`Unexpected response: ${response.status()} ${response.url()}`)
          }
        })
        await page.goto(new URL(path, server.url).href)
        await page.getByRole('heading', { name: 'Raw2Reel API', exact: false }).waitFor()
        await page.waitForSelector('.opblock')
        await page.waitForLoadState('networkidle')
        const prefix = path.startsWith('/api/') ? '/api' : ''
        const schemaPath = `${prefix}/openapi.json`
        assert(
          responses.some((response) => response.path === schemaPath && response.status === 200),
        )
        const document = await (
          await context.request.get(new URL(schemaPath, server.url).href)
        ).json()
        const expectedOperations = Object.values(document.paths).reduce(
          (count: number, item: unknown) =>
            count +
            Object.keys(item as object).filter((method) =>
              ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(
                method,
              ),
            ).length,
          0,
        )
        const operations = await page.locator('.opblock').count()
        assert.equal(operations, expectedOperations)
        assert.equal(await page.getByText('Failed to load API definition').count(), 0)
        assert.equal(await page.getByRole('button', { name: 'Try it out' }).count(), 0)
        assert.deepEqual(errors, [])
        if (process.env.DOCS_SCREENSHOT && path === '/api/docs') {
          await page.screenshot({ path: process.env.DOCS_SCREENSHOT, fullPage: true })
        }
        console.log(JSON.stringify({ path, operations, responses, errors }))
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
} finally {
  server.stop(true)
}
