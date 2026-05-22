<x-layouts.app title="Auralith Maps Admin">
    <main class="admin-shell" data-admin-app>
        <aside class="admin-sidebar liquid-glass">
            <div class="brand-lockup">
                <div class="brand-mark" aria-hidden="true">A.</div>
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
                <a href="/">Карта</a>
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

            <form data-admin-editor class="admin-editor-form">
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
                <p class="form-message hidden" data-admin-message></p>
                <button class="route-button" type="submit">Сохранить</button>
            </form>

            <details id="import-panel" class="import-panel" open>
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
    </main>
</x-layouts.app>
