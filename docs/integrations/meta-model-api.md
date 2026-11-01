# Meta Model API: проверенные точки интеграции

Проверено 29 октября 2026 года по официальной документации Meta.
Это справка для реализации; подключение и доступ аккаунта ещё не проверены.

## Общая конфигурация

- Базовый адрес: `https://api.meta.ai/v1`.
- Ключ серверного приложения: `MODEL_API_KEY`, как в примерах Meta.
- HTTP-аутентификация: `Authorization: Bearer <MODEL_API_KEY>`.
- Ключ не должен попадать во frontend, URL, репозиторий или логи.

Источник: [Quickstart](https://dev.meta.ai/docs/quickstart).

## Анализ видео и план монтажа

Muse Spark принимает видео и возвращает текст. Его ответ можно использовать
для плана монтажа, но сборку MP4 нужно реализовать отдельно.

- Документированная актуальная модель: `muse-spark-1.3`.
- Загрузка видео: `POST /v1/files`, `purpose=user_data`.
- Анализ: `POST /v1/responses`; загруженное видео передаётся как
  `input_file` с `file_id`.
- Для доступного по URL видео предусмотрен `input_video` с `video_url`.
- Для плана монтажа есть режим структурированного вывода; полученные интервалы
  всё равно нужно проверять относительно длительности исходного файла.
- Документация предупреждает об ограниченной поддержке аудио в Spark 1.3;
  транскрипцию лучше выполнять отдельной речевой моделью.

Источники: [Models](https://dev.meta.ai/docs/models),
[Video and audio understanding](https://dev.meta.ai/docs/video-understanding),
[Structured output](https://dev.meta.ai/docs/structured-output).

## Транскрипция

- Модель: `muse-voice-transcribe-1.0`.
- Для загруженного файла: `POST /v1/asr/transcribe`.
- Multipart-части: `request` с JSON-настройками и `audio` с WAV-файлом.
- WAV: моно, 16-битный PCM, 16 или 24 кГц.
- Режим `ENDPOINTING` возвращает реплики; `DIARIZATION` добавляет метки говорящих.
- JSON-ответ содержит `transcript`, `audioDurationMs` и `turns`.
- У реплик есть `startMs`, `endMs` и `transcript`; границы приблизительные.
- Таймкодов отдельных слов и синтеза речи этот API не предоставляет.
- Файловый запрос ограничен 10 минутами аудио или 32 MB, что наступит раньше.

Для первой версии подходят субтитры по репликам. Подсветка каждого слова
потребует отдельного выравнивания текста с аудио.

Источники: [Speech to text](https://dev.meta.ai/docs/speech-to-text),
[Transcribe a recording](https://dev.meta.ai/docs/api-reference/voice/transcribe),
[Voice schemas](https://dev.meta.ai/docs/api-reference/voice/schemas),
[Voice cookbook](https://dev.meta.ai/docs/cookbook/voice-api-fundamentals).

## Визуальная часть

В официальном каталоге не найдена отдельная модель или API `Muse Vision`.
Визуальный анализ поддерживает Muse Spark. Для геометрии объектов и их
сопровождения в видео есть SAM 3.1 (`sam-3.1`) через Responses API.

Сегментация и сопровождение объектов сами по себе не подтверждают возможность
надёжно определять одного и того же человека в разных сценах. Существующий
выбор лиц в интерфейсе требует отдельной проверки подхода.

Источники: [Models](https://dev.meta.ai/docs/models),
[Media segmentation](https://dev.meta.ai/docs/media-segmentation).

## Текущая интеграция Raw2Reel

Используется один облачный пайплайн в `ai/`: SAM обнаруживает/трекует лица,
Spark группирует анонимных персонажей и строит план, Voice транскрибирует речь,
FFmpeg собирает MP4. Облачные вызовы проверялись на реальном коротком фрагменте.

Единый ключ читается из MODEL_API_KEY; отдельных URL Muse-сервисов нет.
Локальные команды — prepare и render-v2. HTTP — /v2/prepare и /v2/render.
Каталог передаётся JSON; основному бэкенду принадлежат хранилища и очередь.
Подробности: [AI README](../../ai/README.md),
[контракт пайплайна](../../ai/CLOUD_PIPELINE.md).
