<x-layouts.app title="Auralith Maps">
    @unless($isEmbed)
        <div class="bg-calligraphy bg-calligraphy-left">Auralith</div>
        <div class="bg-calligraphy bg-calligraphy-right">Maps</div>
    @endunless

    <main class="map-screen {{ $isEmbed ? 'map-screen--embed' : '' }}" data-map-provider="maplibre">
        <div id="parking-map" class="map-canvas" aria-label="Карта бесплатных парковок Москвы"></div>

        <div id="map-fallback" class="map-fallback liquid-glass hidden">
            <span>Карта временно недоступна</span>
            <strong>Проверьте соединение и обновите страницу</strong>
        </div>

        @unless($isEmbed)
        <header class="top-panel liquid-glass">
            <div class="brand-lockup brand-lockup--map">
                <x-brand-logo />
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

        <div class="map-control-stack liquid-glass" aria-label="Инструменты карты">
            <button class="map-control-button map-fullscreen-button" type="button" data-action="toggle-fullscreen" aria-label="На весь экран">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H4a1 1 0 0 0-1 1v4"></path><path d="M16 3h4a1 1 0 0 1 1 1v4"></path><path d="M21 16v4a1 1 0 0 1-1 1h-4"></path><path d="M8 21H4a1 1 0 0 1-1-1v-4"></path></svg>
            </button>
            <div class="layer-switcher" data-layer-switcher>
                <button class="map-control-button layer-switcher__trigger" type="button" data-map-layer-toggle aria-label="Переключить слой карты" aria-expanded="false">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4-8 4-8-4 8-4Z"></path><path d="m4 12 8 4 8-4"></path><path d="m4 17 8 4 8-4"></path></svg>
                </button>
                <div class="layer-switcher__panel liquid-glass" data-map-layer-panel>
                    <button class="layer-switcher__option is-active" type="button" data-map-layer="light">
                        <span class="layer-switcher__swatch layer-switcher__swatch--light"></span>
                        <span>Светлая</span>
                    </button>
                    <button class="layer-switcher__option" type="button" data-map-layer="dark">
                        <span class="layer-switcher__swatch layer-switcher__swatch--dark"></span>
                        <span>Тёмная</span>
                    </button>
                    <button class="layer-switcher__option" type="button" data-map-layer="satellite">
                        <span class="layer-switcher__swatch layer-switcher__swatch--satellite"></span>
                        <span>Спутник</span>
                    </button>
                </div>
            </div>
            <button class="map-control-button map-location-button" type="button" data-action="locate-me" aria-label="Определить мое местоположение">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m12 2 7 19-7-4-7 4 7-19Z"></path>
                </svg>
            </button>
        </div>

        <section id="search-panel" class="search-panel liquid-glass hidden" aria-label="Поиск парковок">
            <div class="panel-header">
                <div>
                    <span class="eyebrow">Поиск</span>
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
                    <span class="eyebrow">Парковки рядом</span>
                    <h2>Парковки в центре</h2>
                </div>
                <button class="icon-button" type="button" data-action="close-list" aria-label="Закрыть список">×</button>
            </div>
            <div id="export-toolbar" class="export-toolbar hidden">
                <button class="ghost-button" type="button" data-action="export-all" title="Экспорт всех точек">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14"></path></svg>
                    <span>Все</span>
                </button>
                <button class="ghost-button" type="button" data-action="export-selected" title="Экспорт выбранных точек">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01"></path></svg>
                    <span>Выбранные</span>
                </button>
                <button class="ghost-button" type="button" data-action="clear-export-selection" title="Сбросить выбор">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>
                    <span>Сброс</span>
                </button>
            </div>
            <p id="export-selection-count" class="export-selection-count hidden">Выбрано: 0</p>
            <div id="spot-list-items" class="spot-list__items"></div>
        </section>

        <section id="profile-panel" class="profile-panel liquid-glass hidden" aria-label="Профиль">
            <div class="panel-header">
                <div>
                    <span class="eyebrow">Профиль</span>
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
            <button type="button" class="nav-button is-active" data-action="show-map" aria-label="Карта">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"></path><path d="M9 3v15M15 6v15"></path></svg>
                <span>Карта</span>
            </button>
            <button type="button" class="nav-button" data-action="open-list" aria-label="Список">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"></path></svg>
                <span>Список</span>
            </button>
            <button type="button" class="nav-button" data-action="open-add" aria-label="Добавить">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>
                <span>Добавить</span>
            </button>
        </nav>

        <section id="add-spot-sheet" class="bottom-sheet liquid-glass hidden" aria-label="Добавить точку парковки">
            <div class="panel-header">
                <div>
                    <span id="spot-form-eyebrow" class="eyebrow">Новая точка</span>
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
