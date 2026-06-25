<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class FuelStationApiTest extends TestCase
{
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
            ->assertJsonPath('data.0.available', true)
            ->assertJsonPath('data.0.prices.АИ-95', '63,49 ₽')
            ->assertJsonPath('data.1.available', false);
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
}
