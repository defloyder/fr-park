# Auralith Maps

Мобильный веб-сервис на Laravel для поиска и добавления парковочных точек в Москве. Главный экран — интерактивная карта Яндекса с точками, карточками мест, маршрутами, фото, статусами и формой добавления/редактирования.

## Возможности

- карта Яндекса с кластеризацией и кастомными маркерами;
- список и поиск точек по районам Москвы;
- карточка парковки с адресом, координатами, описанием, фото, ориентирами и инструкцией заезда;
- построение маршрута через Яндекс Карты;
- добавление точки кликом по карте;
- автоматическое определение адреса по координатам;
- загрузка нескольких фото, drag and drop и камера на телефоне;
- редактирование и удаление точек;
- статусы: `Проверено`, `Не проверено`, `Временная`, `Неактуально`;
- API endpoints для будущего отдельного frontend/backend.

## Стек

- PHP 8.3+
- Laravel 12
- SQLite по умолчанию, можно заменить на MySQL/PostgreSQL
- Blade
- Laravel Vite
- Vanilla JS
- Yandex Maps JavaScript API 2.1

## Требования

Перед запуском установите:

- PHP 8.3 или новее
- Composer
- Node.js 20+ и npm
- Git
- расширения PHP, типичные для Laravel: `pdo`, `mbstring`, `openssl`, `tokenizer`, `xml`, `ctype`, `json`, `fileinfo`

## Установка

Клонируйте проект:

```bash
git clone https://github.com/defloyder/fr-park.git
cd fr-park
```

Установите PHP-зависимости:

```bash
composer install
```

Установите frontend-зависимости:

```bash
npm install
```

Создайте `.env`:

```bash
cp .env.example .env
```

На Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Сгенерируйте ключ приложения:

```bash
php artisan key:generate
```

## Настройка карты

Получите ключ Yandex Maps JavaScript API и добавьте его в `.env`:

```env
YANDEX_MAPS_API_KEY=your_key_here
AURALITH_ADMIN_EMAIL=admin@example.com
```

Без ключа приложение откроется, но интерактивная карта не загрузится.
`AURALITH_ADMIN_EMAIL` включает админ-доступ для аккаунта с этим email: импорт и экспорт точек доступны только ему.

## База данных

По умолчанию проект настроен на SQLite:

```env
DB_CONNECTION=sqlite
```

Создайте файл базы:

```bash
touch database/database.sqlite
```

На Windows PowerShell:

```powershell
New-Item database/database.sqlite -ItemType File -Force
```

Запустите миграции и сидеры:

```bash
php artisan migrate --seed
```

Сидеры добавят демонстрационные точки в центре Москвы. Это тестовые данные, они не подтверждают юридически бесплатную парковку.

## Загрузка фото

Для работы публичных ссылок на загруженные фото создайте storage link:

```bash
php artisan storage:link
```

Загруженные файлы хранятся в `storage/app/public`, а наружу отдаются через `public/storage`.

## Запуск проекта

В одном терминале запустите Laravel:

```bash
php artisan serve
```

Во втором терминале запустите Vite:

```bash
npm run dev
```

Откройте:

```text
http://127.0.0.1:8000
```

## Быстрый запуск одной командой

Можно использовать Laravel dev script:

```bash
composer run dev
```

Он запускает Laravel server, queue listener, logs и Vite одновременно.

## Сборка frontend

Для production-сборки:

```bash
npm run build
```

## Тесты

```bash
php artisan test
```

## Production Deploy

Для продакшн-развёртывания через Docker Compose используйте:

```text
DEPLOY.md
docker-compose.prod.yml
Dockerfile
.env.production.example
```

Коротко:

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Подробная инструкция: [DEPLOY.md](DEPLOY.md).

## Основные API endpoints

```http
GET /api/parking-spots
GET /api/parking-spots/{id}
POST /api/parking-spots
PATCH /api/parking-spots/{id}
DELETE /api/parking-spots/{id}
POST /api/parking-spots/photo
```

`DELETE` скрывает точку с карты через статус, а не удаляет запись физически.

## Настройка MySQL или PostgreSQL

Если не хотите SQLite, поменяйте блок БД в `.env`.

Пример MySQL:

```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=fr_park
DB_USERNAME=root
DB_PASSWORD=
```

После этого выполните:

```bash
php artisan migrate --seed
```

## Типичные проблемы

Если карта не появляется:

- проверьте `YANDEX_MAPS_API_KEY` в `.env`;
- очистите конфиг: `php artisan config:clear`;
- убедитесь, что сайт открыт через `php artisan serve`, а не просто как файл.

Если фото загрузилось, но не открывается:

```bash
php artisan storage:link
```

Если изменения CSS/JS не видны:

```bash
npm run dev
```

или пересоберите assets:

```bash
npm run build
```

## Структура важных файлов

```text
app/Http/Controllers/Api/ParkingSpotController.php
app/Http/Requests/StoreParkingSpotRequest.php
app/Http/Requests/UpdateParkingSpotRequest.php
app/Http/Resources/ParkingSpotResource.php
app/Models/ParkingSpot.php
database/migrations/
database/seeders/ParkingSpotSeeder.php
resources/views/pages/map.blade.php
resources/js/modules/parking-api.js
resources/js/modules/parking-form.js
resources/js/modules/yandex-map.js
resources/css/map-ui.css
routes/api.php
routes/web.php
```

## Переменные окружения

Минимально важные:

```env
APP_NAME="Auralith Maps"
APP_ENV=local
APP_DEBUG=true
APP_URL=http://127.0.0.1:8000

DB_CONNECTION=sqlite
YANDEX_MAPS_API_KEY=your_key_here
AURALITH_ADMIN_EMAIL=admin@example.com
```

Не коммитьте `.env`: он уже добавлен в `.gitignore`.
