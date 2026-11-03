#!/usr/bin/env bash
# Настройка машины-выхода к Meta. Запускается на ней самой, из этого каталога:
#   scp -r infra/india nik@<ip>:/tmp/ && ssh nik@<ip> 'sudo bash /tmp/india/setup.sh'
#
# Зачем всё это: с адреса шведского хоста Meta не отдаёт модели (проверено,
# 404 model_not_found 40 раз из 40), а с этой машины отдаёт. Поэтому запросы
# AI-сервиса к api.meta.ai идут сюда через обратный SSH-туннель, а наружу — с
# этого адреса. Видео при этом остаётся в Швеции: сюда едут только вызовы API.
#
# Скрипт идемпотентен: повторный запуск ничего не ломает.
set -euo pipefail

SWEDEN_HOST="${SWEDEN_HOST:-nik@20.240.128.170}"
BRIDGE="${BRIDGE:-172.18.0.1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ $EUID -eq 0 ]] || { echo "нужен root: sudo bash $0" >&2; exit 1; }

echo "--> tinyproxy"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq tinyproxy >/dev/null
install -m 644 "$HERE/tinyproxy.conf" /etc/tinyproxy/tinyproxy.conf
systemctl enable -q --now tinyproxy
systemctl restart tinyproxy

echo "--> пользователь и ключ туннеля"
id metatunnel >/dev/null 2>&1 \
  || useradd --system --create-home --home-dir /var/lib/metatunnel --shell /usr/sbin/nologin metatunnel
install -d -m 700 -o metatunnel -g metatunnel /var/lib/metatunnel/.ssh
if [[ ! -f /var/lib/metatunnel/.ssh/id_ed25519 ]]; then
  ssh-keygen -q -t ed25519 -N "" -C "meta-tunnel@india" -f /var/lib/metatunnel/.ssh/id_ed25519
  chown metatunnel:metatunnel /var/lib/metatunnel/.ssh/id_ed25519{,.pub}
fi

echo "--> юнит туннеля"
sed "s|172\.18\.0\.1|$BRIDGE|; s|nik@20\.240\.128\.170|$SWEDEN_HOST|" \
  "$HERE/meta-tunnel.service" > /etc/systemd/system/meta-tunnel.service
systemctl daemon-reload
systemctl enable -q meta-tunnel

cat <<EOF

Готово на этой стороне. Осталось два шага на шведском хосте:

1. Разрешить ключу проброс (без оболочки), одной строкой в ~/.ssh/authorized_keys:

restrict,port-forwarding $(cat /var/lib/metatunnel/.ssh/id_ed25519.pub)

2. Разрешить привязку не только к петле — ЭТО ТРЕБУЕТ root НА ШВЕДСКОЙ СТОРОНЕ:

   echo 'GatewayPorts clientspecified' | sudo tee /etc/ssh/sshd_config.d/60-raw2reel-tunnel.conf
   sudo systemctl restart ssh

   Без этого sshd не ругается, а молча вешает порт на 127.0.0.1, и контейнеры
   его не видят.

Затем здесь: systemctl start meta-tunnel
И на шведском хосте проверить: ss -ltn | grep $BRIDGE:8888
EOF
