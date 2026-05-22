# Production Deploy

Инструкция для выката ParkFree Moscow на VPS `fr-map.ru` через Docker Compose.

## 0. Безопасность

Если пароли от сервера или панелей уже отправлялись в чат/мессенджер, смените их после первичного входа:

- пароль `root`;
- пароль VMmanager;
- пароль DNSmanager;
- пароль базы данных в `.env.production`.

Желательно позже отключить вход root по паролю и перейти на SSH-ключи.

## 1. DNS

В DNSmanager создайте A-запись:

```text
fr-map.ru.      A      185.117.152.106
www.fr-map.ru.  A      185.117.152.106
```

Дождитесь обновления DNS. Проверка:

```bash
dig +short fr-map.ru
```

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
DB_PASSWORD=strong_random_password
YANDEX_MAPS_API_KEY=your_real_yandex_key
```

## 5. Первый запуск

Соберите и запустите контейнеры:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

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
https://fr-map.ru
```

Caddy внутри app-контейнера сам получит TLS-сертификат Let's Encrypt, если DNS уже смотрит на сервер и порты 80/443 открыты.
