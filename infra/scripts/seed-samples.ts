/**
 * Кладёт файлы в медиа под служебным владельцем `samples`. Через API так
 * нельзя: он создаёт записи только на владельца из сессии — поэтому засев
 * идёт изнутри контейнера бэкенда его же кодом, без дублирования логики
 * ключей и имён блобов.
 *
 * Запускать не руками, а через seed-samples.sh.
 */
import { basename } from 'node:path'
import { config } from './src/config'
import { createMediaService } from './src/media'

const SAMPLES_OWNER = 'samples'

const media = createMediaService(config)
if (!media) {
  console.error('нет MONGO_URL или AZURE_STORAGE_CONNECTION_STRING')
  process.exit(1)
}

const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('нужен хотя бы один файл')
  process.exit(1)
}

for (const path of paths) {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    console.error(`  нет файла: ${path}`)
    process.exit(1)
  }
  const name = basename(path)
  const stored = await media.create(
    new File([await file.arrayBuffer()], name, { type: file.type || 'application/octet-stream' }),
    SAMPLES_OWNER,
  )
  console.log(`  ${name}: ${stored.id}, ${stored.size} байт, ${stored.type}`)
}

const all = await media.list(100, SAMPLES_OWNER)
console.log(`всего сэмплов: ${all.length}`)
