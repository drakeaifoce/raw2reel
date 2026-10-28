import { handle } from './app'
import { config } from './config'

const server = Bun.serve({
  port: config.port,
  hostname: '0.0.0.0',
  fetch: handle,
})

console.log(`backend ${config.version} слушает http://${server.hostname}:${server.port}`)
