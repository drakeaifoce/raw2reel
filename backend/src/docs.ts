import { createOpenAPI } from './openapi'

const assetRoot = new URL('../node_modules/swagger-ui-dist/', import.meta.url)
const headers = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
}
const init = `const base = new URL(location.href);
base.pathname = base.pathname.replace(/\\/docs\\/?$/, '/');
SwaggerUIBundle({ url: new URL('openapi.json', base).href, dom_id: '#swagger-ui', supportedSubmitMethods: [], persistAuthorization: false, validatorUrl: null, deepLinking: true });`

export function docsResponse(request: Request): Response | undefined {
  if (request.method !== 'GET') return
  const path = new URL(request.url).pathname
  if (path === '/openapi.json') return Response.json(createOpenAPI(), { headers })
  if (path === '/docs' || path === '/docs/') {
    const asset = path.endsWith('/') ? './' : 'docs/'
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Raw2Reel API</title><link rel="stylesheet" href="${asset}swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="${asset}swagger-ui-bundle.js"></script><script src="${asset}init.js"></script></body></html>`,
      { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } },
    )
  }
  if (path === '/docs/init.js')
    return new Response(init, { headers: { ...headers, 'content-type': 'text/javascript' } })
  const assets: Record<string, string> = {
    '/docs/swagger-ui-bundle.js': 'text/javascript',
    '/docs/swagger-ui.css': 'text/css',
  }
  if (assets[path])
    return new Response(Bun.file(new URL(path.slice('/docs/'.length), assetRoot)), {
      headers: { ...headers, 'content-type': assets[path] },
    })
}
