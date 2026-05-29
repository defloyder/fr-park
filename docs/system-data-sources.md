# Источники данных Auralith Maps

Этот документ описывает, откуда приложение берет данные для карты, маршрута, камер, трафика, геокодинга и PWA-режима.

## Карта и подложки

- Основная векторная карта: OpenFreeMap vector tiles, источник `https://tiles.openfreemap.org/planet`.
- Данные в OpenFreeMap основаны на OpenMapTiles и OpenStreetMap.
- Шрифты карты: OpenFreeMap glyphs `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`.
- Спутниковая подложка: Esri World Imagery tile service.
- Стили карты собираются локально в `resources/js/modules/map.js` в объекте `MAP_STYLE`.

## Дороги, здания, POI и номера домов

- Дороги, подписи улиц, районы, здания, POI и номера домов приходят из векторного источника OpenFreeMap.
- Используемые source-layer:
  - `transportation` для дорог;
  - `transportation_name` для названий дорог;
  - `building` для 3D-зданий;
  - `poi` для метро, станций, ориентиров, больниц и АЗС;
  - `housenumber` для номеров домов;
  - `place`, `water`, `park`, `landuse`, `boundary` для базовой карты.
- Разметка полос в текущей версии визуальная: отдельные line-слои `road-lane-major` и `road-lane-minor` поверх дорог. Это не отдельная lane-геометрия из навигационного провайдера.

## Парковки

- Пользовательские парковочные точки хранятся в backend приложения.
- Frontend получает их через API `fetchParkingSpots()` из `resources/js/modules/parking-api.js`.
- На карте парковки рендерятся GeoJSON-источником `parking-spots` и слоями кластеров/маркеров в `resources/js/modules/map.js`.

## Маршруты

- Основной endpoint приложения: `/api/route/driving`.
- Backend-контроллер: `app/Http/Controllers/Api/RouteController.php`.
- Приоритет провайдеров:
  - TomTom Routing API, если настроен `services.tomtom_traffic.key`;
  - Yandex Router API, если TomTom недоступен и включен/настроен `services.yandex_router`;
  - frontend fallback на OSRM/OpenStreetMap routing, если backend-маршрут недоступен.
- OSRM fallback в frontend использует:
  - `https://router.project-osrm.org/route/v1/driving/...`;
  - `https://routing.openstreetmap.de/routed-car/route/v1/driving/...`.

## Трафик и задержки

- Для построенного маршрута TomTom Routing API возвращает:
  - `trafficDelayInSeconds`;
  - traffic sections;
  - speed limit sections, если провайдер отдал `sectionType=speedLimit`.
- Backend нормализует это в:
  - `trafficDelaySeconds`;
  - `segments[].traffic` со значениями `free`, `slow`, `heavy`, `jam`;
  - `speedLimits[]`.
- Цвет маршрута на frontend меняется по `segments[].traffic`.
- Отдельный overlay пробок на карте использует TomTom Traffic Flow raster tiles:
  - `https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png`.
- Ключ TomTom для traffic flow берется из `data-tomtom-traffic-key` на `.map-screen`.

## Камеры и антирадар

- Камеры скорости подтягиваются на frontend из OpenStreetMap через Overpass API.
- Запрос находится в `fetchOpenStreetMapSpeedCameras()` в `resources/js/modules/parking-form.js`.
- Используемые OSM-теги:
  - `highway=speed_camera`;
  - `enforcement=maxspeed`, `enforcement=speed`, `enforcement=average_speed`, `enforcement=traffic_signals`, `enforcement=bus_lane`;
  - `camera:type=speed`, `camera:type=redlight`, `camera:type=traffic`, `camera:type=bus_lane`;
  - часть traffic-surveillance объектов: `man_made=surveillance` + `surveillance=traffic/public`.
- Запрос забирает `node`, `way` и `relation` объекты; для линий и отношений используется `center` из Overpass.
- Для каждой камеры сохраняются:
  - координаты;
  - `maxspeed`;
  - `direction`, `camera:direction`, `surveillance:direction`;
  - тип камеры;
  - признак муляжа.
- Камеры дедуплицируются по координатам и фильтруются по близости к активному маршруту.
- Направление камеры вычисляется сравнением bearing камеры с bearing ближайшего участка маршрута:
  - `в спину`;
  - `навстречу`;
  - `справа`;
  - `слева`.
- Антирадар-блок показывает ближайшую предстоящую камеру примерно до 400 м.

## Геолокация и скорость

- Текущая позиция пользователя берется из браузерного Geolocation API.
- Скорость берется из `coords.speed`, переводится из м/с в км/ч.
- Если GPS не дает скорость, показывается `0`.
- Направление движения берется из `coords.heading`, если доступно.

## Геокодинг

- Reverse geocoding вызывается через frontend `reverseGeocode()` из `resources/js/modules/parking-api.js`.
- Endpoint приложения: `/api/geocode/reverse`.
- Контроллер: `app/Http/Controllers/Api/GeocodeController.php`.
- Адрес используется при выборе точки парковки на карте.

## Кэш маршрута и offline-поведение

- Последний дорожный маршрут к точке кэшируется в `localStorage` ключом `auralith:last-driving-route`.
- Активное состояние навигации кэшируется ключом `auralith:navigation-state`.
- Service worker: `public/sw.js`.
- Он кэширует shell `/` и использует network-first/stale-while-revalidate стратегии для части запросов.

## PWA и установка как веб-приложение

- Manifest: `public/site.webmanifest`.
- Service worker регистрируется в `resources/js/app.js`.
- Кнопка установки в профиле использует событие `beforeinstallprompt`.
- На iOS программной установки нет, поэтому показывается подсказка: `Поделиться -> На экран Домой`.

## Ограничения

- Камеры из OSM/Overpass зависят от полноты и актуальности OpenStreetMap.
- Направление камер может быть неточным, если в OSM нет direction-тегов или они заполнены нестандартно.
- Визуальные полосы дорог не являются полноценной lane-моделью навигационного провайдера.
- Traffic flow overlay и route traffic могут отличаться, потому что приходят из разных endpoint TomTom.
