import { handle } from '../src/app'
// Isolated documentation smoke server: no real auth, database or storage services.
Bun.serve({
  hostname: '127.0.0.1',
  port: 43141,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) url.pathname = url.pathname.slice(4)
    return handle(new Request(url, request), {})
  },
})
