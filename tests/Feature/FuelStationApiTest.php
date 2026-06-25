<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class FuelStationApiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    public function test_it_returns_fuel_stations_with_prices_and_availability(): void
    {
        Http::fake([
            'overpass-api.de/*' => Http::response([
                'elements' => [
                    [
                        'type' => 'node',
                        'id' => 42,
                        'lat' => 55.75,
                        'lon' => 37.61,
                        'timestamp' => '2026-06-25T08:00:00Z',
                        'tags' => [
                            'amenity' => 'fuel',
                            'name' => 'Неон Нефть',
                            'fuel:octane_95' => 'yes',
                            'fuel:octane_95:price' => '63.49 RUB',
                        ],
                    ],
                    [
                        'type' => 'node',
                        'id' => 43,
                        'lat' => 55.76,
                        'lon' => 37.62,
                        'tags' => [
                            'amenity' => 'fuel',
                            'name' => 'Закрытая АЗС',
                            'fuel' => 'no',
                        ],
                    ],
                ],
            ]),
        ]);

        $this->getJson('/api/fuel-stations?west=37.5&south=55.7&east=37.7&north=55.8')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Неон Нефть')
            ->assertJsonPath('data.0.availability', 'unknown')
            ->assertJsonPath('data.0.prices.АИ-95', '63,49 ₽')
            ->assertJsonPath('data.1.availability', 'unknown');
    }

    public function test_it_rejects_an_excessively_large_map_area(): void
    {
        $this->getJson('/api/fuel-stations?west=30&south=50&east=40&north=60')
            ->assertUnprocessable();
    }

    public function test_it_uses_tomtom_and_enriches_station_with_open_data_price(): void
    {
        config()->set('services.tomtom_traffic.key', 'tomtom-test-key');

        Http::fake(function ($request) {
            if (str_contains($request->url(), 'api.tomtom.com/search/2/categorySearch/')) {
                return Http::response([
                    'results' => [[
                        'id' => 'station-1',
                        'poi' => [
                            'name' => 'TomTom Fuel',
                            'brands' => [['name' => 'TomTom Brand']],
                        ],
                        'address' => ['freeformAddress' => 'Москва, Тестовая улица, 1'],
                        'position' => ['lat' => 55.75, 'lon' => 37.61],
                        'dataSources' => [
                            'fuelPrice' => ['id' => '1:test-price'],
                        ],
                    ]],
                ]);
            }

            if (str_contains($request->url(), 'api.tomtom.com/search/2/fuelPrice.json')) {
                return Http::response([
                    'fuelPrice' => '1:test-price',
                    'fuels' => [[
                        'type' => 'sp95',
                        'price' => [[
                            'value' => 70.55,
                            'currency' => 'RUB',
                            'currencySymbol' => '₽',
                            'volumeUnit' => 'liter',
                        ]],
                        'updatedAt' => '2026-06-25T09:00:00Z',
                    ]],
                ]);
            }

            if (str_contains($request->url(), 'overpass-api.de')) {
                return Http::response([
                    'elements' => [[
                        'type' => 'node',
                        'id' => 77,
                        'lat' => 55.7501,
                        'lon' => 37.6101,
                        'timestamp' => '2026-06-25T08:00:00Z',
                        'tags' => [
                            'amenity' => 'fuel',
                            'fuel:octane_95' => 'yes',
                            'fuel:octane_95:price' => '64.20',
                        ],
                    ]],
                ]);
            }

            return Http::response([], 404);
        });

        $this->getJson('/api/fuel-stations?west=37.5&south=55.7&east=37.7&north=55.8')
            ->assertOk()
            ->assertJsonPath('meta.source', 'TomTom + OpenStreetMap')
            ->assertJsonPath('data.0.name', 'TomTom Fuel')
            ->assertJsonPath('data.0.prices.АИ-95', '70,55 ₽')
            ->assertJsonPath('data.0.updatedAt', '2026-06-25T09:00:00Z');
    }

    public function test_it_enriches_a_station_from_an_official_tatneft_price_feed(): void
    {
        config()->set('services.tomtom_traffic.key', null);

        Http::fake(function ($request) {
            if (str_contains($request->url(), 'overpass-api.de')) {
                return Http::response([
                    'elements' => [[
                        'type' => 'node',
                        'id' => 10,
                        'lat' => 55.7643,
                        'lon' => 37.4070,
                        'tags' => [
                            'amenity' => 'fuel',
                            'name' => 'Татнефть',
                        ],
                    ]],
                ]);
            }

            if (str_ends_with($request->url(), '/api/v2/azs/')) {
                return Http::response([
                    'status' => 'success',
                    'data' => [[
                        'id' => 222,
                        'lat' => 55.76432,
                        'lon' => 37.40702,
                        'number' => 27,
                        'address' => 'Москва, улица Крылатские Холмы, 40',
                        'fuel' => [[
                            'fuel_type_id' => 34,
                            'price' => 70.99,
                            'updated' => 1782379446,
                        ]],
                    ]],
                ]);
            }

            if (str_contains($request->url(), '/api/v2/azs/fuel_types/')) {
                return Http::response([
                    'status' => 'success',
                    'data' => [
                        'items' => [[
                            'id' => 34,
                            'title' => 'АИ-95',
                        ]],
                    ],
                ]);
            }

            return Http::response([], 404);
        });

        $this->getJson('/api/fuel-stations?west=37.3&south=55.7&east=37.5&north=55.8')
            ->assertOk()
            ->assertJsonPath('meta.source', 'OpenStreetMap + официальные сайты АЗС')
            ->assertJsonPath('data.0.prices.АИ-95', '70,99 ₽')
            ->assertJsonPath('data.0.priceSource', 'Официальная карта АЗС «Татнефть»')
            ->assertJsonPath('data.0.availability', 'unknown');
    }

    public function test_it_parses_prices_from_the_official_neftmagistral_station_page(): void
    {
        config()->set('services.tomtom_traffic.key', null);

        Http::fake(function ($request) {
            if (str_contains($request->url(), 'overpass-api.de')) {
                return Http::response([
                    'elements' => [[
                        'type' => 'node',
                        'id' => 20,
                        'lat' => 55.63327,
                        'lon' => 37.95761,
                        'tags' => [
                            'amenity' => 'fuel',
                            'name' => 'Нефтьмагистраль',
                        ],
                    ]],
                ]);
            }

            if ($request->url() === 'https://neftm.ru/') {
                return Http::response(<<<'HTML'
                    <div class="map-filter__station-item" id="gs901" data-lat="55.633269" data-lng="37.9576">
                        <p class="map-filter__station-address">АЗС 01. МО, Быковское шоссе, стр. 2</p>
                        <div class="map-filter__fuel-price"><p>АИ-95</p><p>79.99</p></div>
                        <div class="map-filter__fuel-price"><p>ДТ</p><p>84.99</p></div>
                    </div>
                    HTML);
            }

            return Http::response([], 404);
        });

        $this->getJson('/api/fuel-stations?west=37.9&south=55.6&east=38&north=55.7')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Нефтьмагистраль №01')
            ->assertJsonPath('data.0.prices.АИ-95', '79,99 ₽')
            ->assertJsonPath('data.0.priceSource', 'Официальная карта АЗС «Нефтьмагистраль»')
            ->assertJsonPath('data.0.availability', 'unknown');
    }

    public function test_it_loads_station_prices_from_the_official_gazpromneft_api(): void
    {
        config()->set('services.tomtom_traffic.key', null);

        Http::fake(function ($request) {
            if (str_contains($request->url(), 'overpass-api.de')) {
                return Http::response([
                    'elements' => [[
                        'type' => 'node',
                        'id' => 30,
                        'lat' => 55.76746,
                        'lon' => 37.40399,
                        'tags' => [
                            'amenity' => 'fuel',
                            'name' => 'Газпромнефть',
                        ],
                    ]],
                ]);
            }

            if ($request->url() === 'https://gpnbonus.ru/api/stations/list') {
                return Http::response([
                    'stations' => [[
                        'GPNAZSID' => 1665,
                        'name' => 'АЗС №10',
                        'city' => 'Москва',
                        'address' => 'Осенняя, 23Б',
                        'latitude' => '55.76746',
                        'longitude' => '37.40399',
                        'workMode' => 'круглосуточно',
                    ]],
                ]);
            }

            if ($request->url() === 'https://gpnbonus.ru/api/stations/1665') {
                return Http::response([
                    'data' => [[
                        'product' => [
                            'shortTitle' => '95',
                            'title' => 'Бензин АИ-95',
                        ],
                        'price' => [
                            'price' => 72.06,
                            'since' => '2026-06-25T08:49:59.000000Z',
                        ],
                    ]],
                ]);
            }

            return Http::response([], 404);
        });

        $this->getJson('/api/fuel-stations?west=37.3&south=55.7&east=37.5&north=55.8')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Газпромнефть АЗС №10')
            ->assertJsonPath('data.0.prices.АИ-95', '72,06 ₽')
            ->assertJsonPath('data.0.updatedAt', '2026-06-25T08:49:59.000000Z')
            ->assertJsonPath('data.0.priceSource', 'Официальная карта АЗС «Газпромнефть»')
            ->assertJsonPath('data.0.availability', 'unknown');
    }

    public function test_it_parses_station_prices_from_the_official_rosneft_map(): void
    {
        config()->set('services.tomtom_traffic.key', null);

        Http::fake(function ($request) {
            if (str_contains($request->url(), 'overpass-api.de')) {
                return Http::response([
                    'elements' => [[
                        'type' => 'node',
                        'id' => 40,
                        'lat' => 55.75,
                        'lon' => 37.61,
                        'tags' => [
                            'amenity' => 'fuel',
                            'name' => 'Роснефть',
                        ],
                    ]],
                ]);
            }

            if ($request->url() === 'https://rosneft-azs.ru/stations') {
                return Http::response(<<<'HTML'
                    <script>
                    window.__NUXT__=(function(a,b,c,d,e,f,g,h){c.id=a;c.label=d;return {stations:{stations:[{id:e,title:"АЗС 12 ПАО Роснефть",address:"Москва, Тестовая улица, 1",brand:f,currency:"RUB",type:"gas_station",region:g,coords:{lat:55.75,lng:37.61},fuelsIds:new Set([a]),servicesIds:new Set([]),fuels:[{id:a,price:b,info:c}],services:[],serivicesInfo:[]}],filters:{}}}}("ai95",72.45,{},"АИ-95",500,"rosneft",{}));
                    </script>
                    HTML);
            }

            return Http::response([], 404);
        });

        $this->getJson('/api/fuel-stations?west=37.5&south=55.7&east=37.7&north=55.8')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Роснефть · АЗС 12')
            ->assertJsonPath('data.0.prices.АИ-95', '72,45 ₽')
            ->assertJsonPath('data.0.priceSource', 'Официальная карта АЗС «Роснефть»')
            ->assertJsonPath('data.0.availability', 'unknown');
    }
}
