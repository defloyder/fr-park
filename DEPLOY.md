# Production Deploy

Инструкция для выката Auralith Maps на VPS `185.117.152.106` и домен `park.auralith.ru` через Docker Compose. Docker-образ приложения использует PHP 8.4.

## 0. Безопасность

Если пароли от сервера или панелей уже отправлялись в чат/мессенджер, смените их после первичного входа:

- пароль `root`;
- пароль VMmanager;
- пароль DNSmanager;
- пароль базы данных в `.env.production`.

Желательно позже отключить вход root по паролю и перейти на SSH-ключи.

## 1. DNS

В DNS создайте A-запись:

```text
park.auralith.ru.  A  185.117.152.106
```

Дождитесь обновления DNS. Проверка:

```bash
dig +short A park.auralith.ru @8.8.8.8
dig +short A park.auralith.ru @1.1.1.1
```

IP-доступ остаётся запасным входом по `http://185.117.152.106`. Основной домен работает по `https://park.auralith.ru`, когда DNS уже обновился.

## 2. Подготовка сервера

Подключитесь по SSH:

```bash
ssh root@185.117.152.106
```

Обновите систему:

```bash
apt update && apt upgrade -y
```

Установите Docker:

```bash
apt install -y ca-certificates curl gnupg git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Откройте HTTP/HTTPS/SSH:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## 3. Загрузка проекта

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/defloyder/fr-park.git
cd fr-park
```

## 4. Production env

```bash
cp .env.production.example .env.production
```

Сгенерируйте APP_KEY:

```bash
docker run --rm -v "$PWD":/app -w /app php:8.3-cli php -r "echo 'base64:'.base64_encode(random_bytes(32)).PHP_EOL;"
```

Откройте `.env.production`:

```bash
nano .env.production
```

Заполните:

```env
APP_KEY=base64:...
APP_URL=https://park.auralith.ru
APP_DOMAIN=park.auralith.ru
APP_IP=185.117.152.106
SESSION_DOMAIN=null
DB_PASSWORD=strong_random_password
AURALITH_ADMIN_EMAIL=your_admin_email@example.com
```

## 5. Первый запуск

Соберите и запустите контейнеры:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

После `git pull` пересоберите и перезапустите контейнер. **Обновление страницы в браузере без пересборки Docker ничего не меняет** — на сервере крутится старый образ.

```bash
git pull origin main
docker compose --env-file .env.production -f docker-compose.prod.yml build app
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml exec app php artisan view:clear
docker compose --env-file .env.production -f docker-compose.prod.yml exec app php artisan config:clear
```

Сборка `app` теперь быстрая: готовый фронтенд лежит в `public/build` в репозитории, Docker не гоняет `npm run build`, если manifest уже есть.

Если карта всё ещё пустая после деплоя — жёсткое обновление в браузере: `Ctrl+Shift+R`.

Посмотрите логи:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
```

Проверка контейнеров:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

## 6. Сидеры

Если нужно добавить демо-точки:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec app php artisan db:seed --class=ParkingSpotSeeder --force
```

## 7. Обновление проекта

```bash
cd /var/www/fr-park
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml exec app php artisan migrate --force
```

## 7.1 Автообновление с GitHub

Код приложения не стоит обновлять через Docker volume: volume лучше использовать для данных (`storage`, Postgres, Redis, сертификаты Caddy). Для кода безопаснее автообновление через `git pull`/`docker compose up --build`.

В репозитории есть готовый скрипт:

```bash
/var/www/fr-park/deploy/auto-update.sh
```

Он:

- проверяет `origin/main`;
- если появился новый commit, делает `git reset --hard origin/main`;
- пересобирает контейнеры;
- запускает миграции;
- обновляет Laravel cache.

Установить systemd timer:

```bash
cd /var/www/fr-park
chmod +x deploy/auto-update.sh
cp deploy/systemd/parkfree-auto-update.service /etc/systemd/system/
cp deploy/systemd/parkfree-auto-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now parkfree-auto-update.timer
```

Проверить таймер:

```bash
systemctl list-timers | grep parkfree
```

Запустить обновление вручную:

```bash
systemctl start parkfree-auto-update.service
```

Посмотреть лог:

```bash
journalctl -u parkfree-auto-update.service -n 100 --no-pager
```

## 8. Полезные команды

Логи приложения:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
```

Войти в контейнер:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec app sh
```

Очистить кеш Laravel:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec app php artisan optimize:clear
```

Перезапуск:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart
```

Остановка:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

## 9. Что должно открыться

```text
https://park.auralith.ru
http://185.117.152.106
```

Caddy внутри app-контейнера сам получит TLS-сертификат Let's Encrypt, если DNS уже смотрит на сервер и порты 80/443 открыты.
