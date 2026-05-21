<x-layouts.app title="ParkFree Moscow">
    <div class="bg-calligraphy bg-calligraphy-left">ParkFree</div>
    <div class="bg-calligraphy bg-calligraphy-right">Moscow</div>

    <main class="map-screen" data-yandex-api-ready="{{ config('services.yandex_maps.key') ? 'true' : 'false' }}">
        <div id="yandex-map" class="map-canvas" aria-label="Карта бесплатных парковок Москвы"></div>

        <div id="map-fallback" class="map-fallback liquid-glass hidden">
            <span>Карта ожидает ключ API</span>
            <strong>Добавьте YANDEX_MAPS_API_KEY в .env</strong>
        </div>

        <header class="top-panel liquid-glass">
            <div>
                <span class="eyebrow">Free parking map</span>
                <h1>ParkFree Moscow</h1>
            </div>
            <button class="icon-button" type="button" data-action="open-search" aria-label="Открыть поиск">
                <span aria-hidden="true">⌕</span>
            </button>
        </header>

        <section id="status-panel" class="status-panel liquid-glass hidden" role="status"></section>
        <section id="pick-panel" class="pick-panel liquid-glass hidden" aria-label="Выбор точки на карте">
            <span>Коснитесь карты в месте парковки</span>
            <div>
                <button class="ghost-button" type="button" data-action="cancel-picking">Отменить</button>
                <button class="route-button" type="button" data-action="return-to-form">К форме</button>
            </div>
        </section>
        <section id="selected-spot-card" class="spot-card liquid-glass hidden" aria-live="polite"></section>

        <section id="search-panel" class="search-panel liquid-glass hidden" aria-label="Поиск парковок">
            <div class="panel-header">
                <div>
                    <span class="eyebrow">Search area</span>
                    <h2>Поиск парковки</h2>
                </div>
                <button class="icon-button" type="button" data-action="close-search" aria-label="Закрыть поиск">×</button>
            </div>

            <label class="search-field">
                <span>Текст</span>
                <input id="spot-search-input" type="search" autocomplete="off" placeholder="Адрес, название, ориентир">
            </label>

            <label class="search-field">
                <span>Район / зона</span>
                <select id="spot-area-select">
                    <option value="">Все районы</option>
                </select>
            </label>

            <div id="search-results" class="search-results"></div>
        </section>

        <section id="spot-list" class="spot-list liquid-glass hidden" aria-label="Список парковок">
            <div class="panel-header">
                <div>
                    <span class="eyebrow">Nearby points</span>
                    <h2>Парковки в центре</h2>
                </div>
                <button class="icon-button" type="button" data-action="close-list" aria-label="Закрыть список">×</button>
            </div>
            <div id="spot-list-items" class="spot-list__items"></div>
        </section>

        <nav class="floating-nav liquid-glass" aria-label="Основная навигация">
            <button type="button" class="nav-button is-active" data-action="show-map">Карта</button>
            <button type="button" class="nav-button" data-action="open-list">Список</button>
            <button type="button" class="nav-button" data-action="open-add">Добавить</button>
        </nav>

        <section id="add-spot-sheet" class="bottom-sheet liquid-glass hidden" aria-label="Добавить точку парковки">
            <div class="panel-header">
                <div>
                    <span id="spot-form-eyebrow" class="eyebrow">New free spot</span>
                    <h2 id="spot-form-title">Добавить парковку</h2>
                </div>
                <button class="icon-button" type="button" data-action="close-add" aria-label="Закрыть форму">×</button>
            </div>

            <p id="form-message" class="form-message hidden"></p>

            <form id="add-spot-form" class="spot-form">
                <label>
                    <span>Название</span>
                    <input name="title" type="text" maxlength="255" autocomplete="off" placeholder="Например, парковка у Арбата" required>
                </label>

                <label>
                    <span>Адрес</span>
                    <input name="address" type="text" maxlength="500" autocomplete="off" placeholder="Адрес определится по точке на карте">
                </label>

                <label>
                    <span>Статус</span>
                    <select name="availability_status">
                        <option value="unverified">Не проверено</option>
                        <option value="verified">Проверено</option>
                        <option value="temporary">Временная</option>
                        <option value="outdated">Неактуально</option>
                    </select>
                </label>

                <div class="form-grid">
                    <label>
                        <span>Широта</span>
                        <input name="latitude" type="number" step="0.0000001" min="-90" max="90" placeholder="55.7558" required>
                    </label>
                    <label>
                        <span>Долгота</span>
                        <input name="longitude" type="number" step="0.0000001" min="-180" max="180" placeholder="37.6173" required>
                    </label>
                </div>

                <label>
                    <span>Описание</span>
                    <textarea name="description" rows="3" maxlength="2000" placeholder="Ориентир, условия, примечания"></textarea>
                </label>

                <label>
                    <span>Фото</span>
                    <input name="photo_url" type="text" maxlength="1000" placeholder="https://... или /storage/...">
                </label>

                <div id="photo-dropzone" class="photo-dropzone" tabindex="0">
                    <input id="photo-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden>
                    <input id="photo-camera-input" type="file" accept="image/*" capture="environment" hidden>
                    <strong>Перетащите фото сюда</strong>
                    <span>можно несколько файлов или снимок с камеры</span>
                    <div class="photo-dropzone__actions">
                        <button type="button" class="ghost-button" data-action="choose-photo">Выбрать фото</button>
                        <button type="button" class="ghost-button" data-action="take-photo">Сфотографировать</button>
                    </div>
                </div>

                <div id="photo-preview-list" class="photo-preview-list"></div>

                <label>
                    <span>Как заехать</span>
                    <textarea name="access_instructions" rows="2" maxlength="2000" placeholder="С какой улицы удобнее подъехать"></textarea>
                </label>

                <label>
                    <span>Ориентиры</span>
                    <textarea name="landmarks" rows="2" maxlength="2000" placeholder="Метро, здание, въезд, двор, шлагбаум"></textarea>
                </label>

                <label>
                    <span>Примечания</span>
                    <textarea name="parking_notes" rows="2" maxlength="2000" placeholder="Ограничения, время, что проверить на месте"></textarea>
                </label>

                <div class="form-actions">
                    <button class="ghost-button" type="button" data-action="pick-on-map">Выбрать на карте</button>
                    <button class="route-button" type="submit">Сохранить</button>
                </div>

                <button id="delete-spot-button" class="danger-button hidden" type="button" data-action="delete-spot">Удалить точку</button>
            </form>
        </section>
    </main>
</x-layouts.app>
