<x-layouts.app title="Auralith Maps Admin">
    <main class="admin-shell" data-admin-app>
        <aside class="admin-sidebar liquid-glass">
            <div class="brand-lockup">
                <x-brand-logo />
                <div>
                    <span class="eyebrow">Auralith Maps</span>
                    <h1>Админ-панель</h1>
                </div>
            </div>

            <div class="admin-stats">
                <article>
                    <span>Всего</span>
                    <strong data-admin-stat="total">0</strong>
                </article>
                <article>
                    <span>Проверено</span>
                    <strong data-admin-stat="verified">0</strong>
                </article>
                <article>
                    <span>С фото</span>
                    <strong data-admin-stat="photos">0</strong>
                </article>
            </div>

            <nav class="admin-nav">
                <button type="button" data-admin-open-map title="Открыть карту">Карта</button>
                <a href="/api/parking-spots/export" data-admin-export-all>Экспорт JSON</a>
            </nav>
        </aside>

        <section class="admin-workspace liquid-glass">
            <header class="admin-header">
                <div>
                    <span class="eyebrow">Moderation desk</span>
                    <h2>Точки парковок</h2>
                </div>
                <div class="admin-actions">
                    <button class="ghost-button" type="button" data-admin-refresh>Обновить</button>
                    <button class="route-button" type="button" data-admin-export-selected>Экспорт выбранных</button>
                </div>
            </header>

            <div class="admin-filters">
                <input data-admin-search type="search" placeholder="Адрес, название, описание">
                <select data-admin-status>
                    <option value="">Все статусы</option>
                    <option value="verified">Проверено</option>
                    <option value="unverified">Не проверено</option>
                    <option value="temporary">Временная</option>
                    <option value="outdated">Неактуально</option>
                </select>
                <select data-admin-visibility>
                    <option value="">Все видимости</option>
                    <option value="active">Активные</option>
                    <option value="pending">Ожидают</option>
                    <option value="hidden">Скрытые</option>
                </select>
            </div>

            <div class="admin-bulkbar">
                <span data-admin-selected-count>Выбрано: 0</span>
                <button class="ghost-button" type="button" data-admin-bulk="verified">Проверено</button>
                <button class="ghost-button" type="button" data-admin-bulk="temporary">Временная</button>
                <button class="ghost-button" type="button" data-admin-bulk="outdated">Неактуально</button>
                <button class="ghost-button" type="button" data-admin-activate>Активировать</button>
                <button class="danger-button" type="button" data-admin-hide>Скрыть</button>
            </div>

            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th><input data-admin-check-all type="checkbox" aria-label="Выбрать все"></th>
                            <th>Точка</th>
                            <th>Статус</th>
                            <th>Фото</th>
                            <th>Видимость</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody data-admin-rows></tbody>
                </table>
            </div>
        </section>

        <aside class="admin-editor liquid-glass">
            <div class="admin-header">
                <div>
                    <span class="eyebrow">Point editor</span>
                    <h2 data-admin-editor-title>Выберите точку</h2>
                </div>
            </div>

            <div class="admin-empty-editor" data-admin-empty-editor>
                <strong>Точка не выбрана</strong>
                <span>Нажмите «Открыть» в таблице, чтобы редактировать адрес, описание, фото и статус.</span>
            </div>

            <form data-admin-editor class="admin-editor-form hidden">
                <input name="id" type="hidden">
                <label>
                    <span>Название</span>
                    <input name="title" type="text" maxlength="255" required>
                </label>
                <label>
                    <span>Адрес</span>
                    <input name="address" type="text" maxlength="500">
                </label>
                <label>
                    <span>Статус</span>
                    <select name="availability_status">
                        <option value="verified">Проверено</option>
                        <option value="unverified">Не проверено</option>
                        <option value="temporary">Временная</option>
                        <option value="outdated">Неактуально</option>
                    </select>
                </label>
                <div class="form-grid">
                    <label>
                        <span>Широта</span>
                        <input name="latitude" type="number" step="0.0000001" required>
                    </label>
                    <label>
                        <span>Долгота</span>
                        <input name="longitude" type="number" step="0.0000001" required>
                    </label>
                </div>
                <label>
                    <span>Описание</span>
                    <textarea name="description" rows="3"></textarea>
                </label>
                <label>
                    <span>Как заехать</span>
                    <textarea name="access_instructions" rows="2"></textarea>
                </label>
                <label>
                    <span>Ориентиры</span>
                    <textarea name="landmarks" rows="2"></textarea>
                </label>
                <label>
                    <span>Фото URL через запятую</span>
                    <textarea name="photo_urls" rows="3"></textarea>
                </label>
                <div class="admin-photo-dropzone" data-admin-photo-dropzone tabindex="0">
                    <input data-admin-photo-input type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden>
                    <strong>Перетащите фото сюда</strong>
                    <span>или нажмите, чтобы выбрать несколько файлов</span>
                </div>
                <div class="admin-photo-preview-list" data-admin-photo-preview></div>
                <p class="form-message hidden" data-admin-message></p>
                <button class="route-button" type="submit">Сохранить</button>
            </form>

            <details id="import-panel" class="import-panel">
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
        </aside>

        <section class="admin-users-panel liquid-glass">
            <header class="admin-header">
                <div>
                    <span class="eyebrow">Users</span>
                    <h2>Пользователи</h2>
                </div>
                <button class="ghost-button" type="button" data-admin-users-refresh>Обновить</button>
            </header>
            <div class="admin-table-wrap">
                <table class="admin-table admin-users-table">
                    <thead>
                        <tr>
                            <th>Пользователь</th>
                            <th>Email</th>
                            <th>Роль</th>
                            <th>Дата регистрации</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody data-admin-users></tbody>
                </table>
            </div>
        </section>

        <section class="admin-map-modal hidden" data-admin-map-modal>
            <div class="admin-map-window liquid-glass">
                <header class="admin-header">
                    <div>
                        <span class="eyebrow">Map preview</span>
                        <h2>Карта</h2>
                    </div>
                    <button class="icon-button" type="button" data-admin-close-map aria-label="Закрыть карту">×</button>
                </header>
                <iframe src="/?embed=1" title="Auralith Maps"></iframe>
            </div>
        </section>
    </main>
</x-layouts.app>
