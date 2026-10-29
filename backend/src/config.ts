/**
 * Конфигурация читается только отсюда. Каждая переменная описана в корневом
 * .env.example; отсутствующие значения не роняют процесс, а гасят зависимость —
 * сервис поднимается и честно рапортует о ней в /ready.
 */
export type Config = {
  port: number
  version: string
  mongoUrl: string | undefined
  mongoDb: string
  blobConnectionString: string | undefined
  blobContainerUploads: string
  blobContainerRenders: string
  mediaAllowedTypes: string[]
  maxMediaSizeBytes: number
}

const positiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3000),
  // Подставляется при сборке образа через --build-arg GIT_SHA, поэтому не может
  // разойтись с тем, что развёрнуто. Локальный запуск отдаёт dev.
  version: process.env.GIT_SHA ?? 'dev',
  mongoUrl: process.env.MONGO_URL,
  mongoDb: process.env.MONGO_DB ?? 'raw2reel',
  blobConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
  blobContainerUploads: process.env.AZURE_BLOB_CONTAINER_UPLOADS ?? 'uploads',
  blobContainerRenders: process.env.AZURE_BLOB_CONTAINER_RENDERS ?? 'renders',
  mediaAllowedTypes: (process.env.MEDIA_ALLOWED_TYPES ?? 'video/*,image/*,audio/*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  maxMediaSizeBytes: positiveNumber(process.env.MAX_MEDIA_SIZE_BYTES, 100 * 1024 * 1024),
}
