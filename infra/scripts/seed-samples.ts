/**
 * Кладёт файлы в медиа под служебным владельцем `samples`. Через API так
 * нельзя: он создаёт записи только на владельца из сессии — поэтому засев
 * идёт изнутри контейнера бэкенда его же кодом, без дублирования логики
 * ключей и имён блобов.
 *
 * Список приходит JSON-ом в stdin: [{ "path": "...", "name": "..." }].
 * Именно так, а не аргументами: в именах треков бывают пробелы, запятые и
 * скобки, и передача через argv по дороге к docker exec их разваливает.
 *
 * Запускать не руками, а через seed-samples.sh.
 */
import { config } from './src/config'
import { createMediaService } from './src/media'

const SAMPLES_OWNER = 'samples'

const media = createMediaService(config)
if (!media) {
  console.error('нет MONGO_URL или AZURE_STORAGE_CONNECTION_STRING')
  process.exit(1)
}

type Entry = { path: string; name: string }

const input = await Bun.stdin.text()
let entries: Entry[]
try {
  entries = JSON.parse(input) as Entry[]
} catch {
  console.error('на вход нужен JSON вида [{ "path": "...", "name": "..." }]')
  process.exit(1)
}
if (!Array.isArray(entries) || entries.length === 0) {
  console.error('список пуст')
  process.exit(1)
}

for (const { path, name } of entries) {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    console.error(`  нет файла: ${path}`)
    process.exit(1)
  }
  // Тип определяем по НАСТОЯЩЕМУ имени, а не по пути: файлы едут в контейнер
  // под служебными именами вроде seed-0.bin, и Bun.file(path).type дал бы
  // application/octet-stream. С ним браузер не проигрывает трек, а рендер
  // ждёт audio/*.
  const type = Bun.file(name).type || 'application/octet-stream'
  const stored = await media.create(
    new File([await file.arrayBuffer()], name, { type }),
    SAMPLES_OWNER,
  )
  console.log(`  ${name}: ${stored.id}, ${stored.size} байт, ${stored.type}`)
}

const all = await media.list(100, SAMPLES_OWNER)
console.log(`всего сэмплов: ${all.length}`)
