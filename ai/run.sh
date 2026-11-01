# подготовка лиц для выбора, 
CLOUD_DISCOVERY_FRAMES=8 CLOUD_MAX_OBSERVATIONS=32 \
.venv/bin/python -m raw2reel_ai --env-file ../.env --debug prepare \
  "../assets/video/Im_Coming_Back_For_Everything_The_Social_Network_get_save_com.mp4" \
  --output outputs/preview-analysis.json \
  --overwrite

# создание самого рисла, по указанному лицу
.venv/bin/python -m raw2reel_ai --env-file ../.env --debug render-v2 \
  "../assets/video/Im_Coming_Back_For_Everything_The_Social_Network_get_save_com.mp4" \
  --analysis outputs/preview-analysis.json \
  --person p1 \
  --music "../assets/audio/ATSMXN, XTOM - Enemies [NCS Release].mp3" \
  --output outputs/reel-v2.mp4 \
  --duration 20 \
  --overwrite