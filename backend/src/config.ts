/**
 * Конфигурация читается только отсюда. Каждая переменная описана в корневом
 * .env.example; отсутствующие значения не роняют процесс, а гасят зависимость —
 * сервис поднимается и честно рапортует о ней в /ready.
 */
export type Config = {
  port: number
  mongoUrl: string | undefined
  mongoDb: string
  blobConnectionString: string | undefined
  blobContainerUploads: string
  blobContainerRenders: string
}

export const config: Config = {
  port: Number(process.env.PORT ?? 3000),
  mongoUrl: process.env.MONGO_URL,
  mongoDb: process.env.MONGO_DB ?? 'raw2reel',
  blobConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
  blobContainerUploads: process.env.AZURE_BLOB_CONTAINER_UPLOADS ?? 'uploads',
  blobContainerRenders: process.env.AZURE_BLOB_CONTAINER_RENDERS ?? 'renders',
}
