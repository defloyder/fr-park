<x-layouts.app title="Auralith Maps">
    @unless($isEmbed)
        <div class="bg-calligraphy bg-calligraphy-left">Auralith</div>
        <div class="bg-calligraphy bg-calligraphy-right">Maps</div>
    @endunless

    <main class="map-screen {{ $isEmbed ? 'map-screen--embed' : '' }}" data-yandex-api-ready="{{ config('services.yandex_maps.key') ? 'true' : 'false' }}">
        <div id="yandex-map" class="map-canvas" aria-label="Карта бесплатных парковок Москвы"></div>

        <div id="map-fallback" class="map-fallback liquid-glass hidden">
            <span>Карта ожидает ключ API</span>
            <strong>Добавьте YANDEX_MAPS_API_KEY в .env</strong>
        </div>

        @unless($isEmbed)
        <header class="top-panel liquid-glass">
            <div class="brand-lockup brand-lockup--map">
                <div class="brand-mark auralith-mark" aria-hidden="true">
                    <svg viewBox="0 0 80 80">
                        <defs>
                            <linearGradient id="auralithGradientMap" x1="12" y1="68" x2="64" y2="12" gradientUnits="userSpaceOnUse">
                                <stop stop-color="#00D4FF"/>
                                <stop offset="0.55" stop-color="#446CFF"/>
                                <stop offset="1" stop-color="#A259FF"/>
                            </linearGradient>
                        </defs>
                        <path fill="url(#auralithGradientMap)" d="M42.6 12.8c-5.7 0-8.2 3-10.7 7.7L11.7 58.8c-2.8 5.3 1 11.7 7 11.7h31.2c8.1 0 14.2-4 17.6-11.3 2.4-5.2-3-10.4-8.1-7.8-2.2 1.1-3.9 2.9-5.7 4.4-2 1.8-4.3 2.5-7.5 2.5H31.1l14-26.7 8.3 15.7c2.9 5.4 10.6 5.8 14 .7 1.6-2.4 1.7-5.5.4-8.1L53.7 20.5c-2.5-4.7-5.4-7.7-11.1-7.7Z"/>
                        <circle fill="url(#auralithGradientMap)" cx="61.5" cy="62" r="9.5"/>
                    </svg>
                </div>
                <div>
                    <span class="eyebrow">Карта бесплатных парковок</span>
                    <h1>Auralith</h1>
                </div>
            </div>
            <div class="top-panel__actions">
                <button class="icon-button" type="button" data-action="open-search" aria-label="Открыть поиск">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m21 21-4.35-4.35"></path>
                        <circle cx="11" cy="11" r="6.5"></circle>
                    </svg>
                </button>
                <button class="icon-button" type="button" data-action="open-profile" aria-label="Открыть профиль">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="12" cy="8" r="4"></circle>
                        <path d="M4.5 20a7.5 7.5 0 0 1 15 0"></path>
                    </svg>
                </button>
            </div>
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
            <div id="export-toolbar" class="export-toolbar hidden">
                <button class="ghost-button" type="button" data-action="export-all">Экспорт всех</button>
                <button class="ghost-button" type="button" data-action="export-selected">Экспорт выбранных</button>
                <button class="ghost-button" type="button" data-action="clear-export-selection">Сброс</button>
            </div>
            <p id="export-selection-count" class="export-selection-count hidden">Выбрано: 0</p>
            <div id="spot-list-items" class="spot-list__items"></div>
        </section>

        <section id="profile-panel" class="profile-panel liquid-glass hidden" aria-label="Профиль">
            <div class="panel-header">
                <div>
                    <span class="eyebrow">Profile</span>
                    <h2 id="profile-title">Аккаунт</h2>
                </div>
                <button class="icon-button" type="button" data-action="close-profile" aria-label="Закрыть профиль">×</button>
            </div>

            <div id="profile-user" class="profile-user hidden"></div>

            <form id="auth-form" class="auth-form">
                <div class="auth-tabs">
                    <button class="auth-tab is-active" type="button" data-auth-mode="login">Вход</button>
                    <button class="auth-tab" type="button" data-auth-mode="register">Регистрация</button>
                </div>

                <label class="auth-name-field hidden">
                    <span>Имя</span>
                    <input name="name" type="text" autocomplete="name" maxlength="255" placeholder="Как к вам обращаться">
                </label>

                <label>
                    <span>Email</span>
                    <input name="email" type="email" autocomplete="email" maxlength="255" placeholder="you@example.com" required>
                </label>

                <label>
                    <span>Пароль</span>
                    <input name="password" type="password" autocomplete="current-password" minlength="8" placeholder="Минимум 8 символов" required>
                </label>

                <p id="auth-message" class="form-message hidden"></p>
                <button id="auth-submit" class="route-button" type="submit">Войти</button>
            </form>

            <div id="favorite-panel" class="favorite-panel hidden">
                <div class="favorite-panel__head">
                    <span class="eyebrow">Saved spots</span>
                    <button class="ghost-button" type="button" data-action="logout">Выйти</button>
                </div>
                <div id="favorite-list" class="favorite-list"></div>
            </div>
        </section>

        <nav class="floating-nav liquid-glass" aria-label="Основная навигация">
            <button type="button" class="nav-button is-active" data-action="show-map">Карта</button>
            <button type="button" class="nav-button" data-action="open-list">Список</button>
            <button type="button" class="nav-button" data-action="open-add">Добавить</button>
        </nav>

        <section id="add-spot-sheet" class="bottom-sheet liquid-glass hidden" aria-label="Добавить точку парковки">
            <div class="panel-header">
                <div>
                    <span id="spot-form-eyebrow" class="eyebrow">New parking point</span>
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

                <label class="address-picker-field">
                    <span>Адрес</span>
                    <div class="address-picker-field__control">
                        <input name="address" type="text" maxlength="500" autocomplete="off" placeholder="Адрес определится по точке на карте">
                        <button class="field-icon-button" type="button" data-action="pick-on-map" aria-label="Выбрать точку на карте">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"></path>
                                <circle cx="12" cy="9" r="2.5"></circle>
                            </svg>
                        </button>
                    </div>
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
                    <span>можно несколько файлов</span>
                    <div class="photo-dropzone__actions">
                        <button type="button" class="ghost-button" data-action="choose-photo">Выбрать фото</button>
                        <button type="button" class="ghost-button camera-button" data-action="take-photo">Сфотографировать</button>
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

                <button class="route-button" type="submit">Сохранить</button>

                <button id="delete-spot-button" class="danger-button hidden" type="button" data-action="delete-spot">Удалить точку</button>
            </form>

            <details id="import-panel" class="import-panel hidden">
                <summary>Массовый импорт JSON</summary>
                <form id="import-spots-form" class="import-form">
                    <label>
                        <span>Файл JSON / TXT</span>
                        <input id="import-json-file" name="json_file" type="file" accept=".json,.txt,application/json,text/plain">
                    </label>

                    <label>
                        <span>Или вставьте JSON</span>
                        <textarea name="json_text" rows="5" placeholder="[{'name': 'Москва...', 'lat': 55.7, 'lng': 37.6}]"></textarea>
                    </label>

                    <p id="import-message" class="form-message hidden"></p>
                    <button class="ghost-button" type="submit">Импортировать точки</button>
                </form>
            </details>
        </section>
        @endunless
    </main>
</x-layouts.app>
