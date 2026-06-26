<?php

namespace App\Services;

use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

class FuelStationService
{
    public function __construct(private readonly OfficialFuelPriceService $officialPrices) {}

    private const TOMTOM_FUEL_TYPES = [
        'regular' => 'Бензин',
        'sp91' => 'АИ-91',
        'sp91_e10' => 'АИ-91 E10',
        'sp92' => 'АИ-92',
        'sp92Plus' => 'АИ-92+',
        'sp93' => 'АИ-93',
        'sp95' => 'АИ-95',
        'sp95_e10' => 'АИ-95 E10',
        'sp95Plus' => 'АИ-95+',
        'sp95WithoutAdditives' => 'АИ-95',
        'sp97' => 'АИ-97',
        'sp98' => 'АИ-98',
        'sp98Plus' => 'АИ-98+',
        'sp99' => 'АИ-99',
        'sp100' => 'АИ-100',
        'diesel' => 'ДТ',
        'dieselPlus' => 'ДТ+',
        'dieselWithoutAdditives' => 'ДТ',
        'dieselPlusWithoutAdditives' => 'ДТ+',
        'lpg' => 'Газ',
        'cng' => 'Метан',
        'e85' => 'E85',
        'e100' => 'E100',
        'biodiesel' => 'Биодизель',
    ];

    private const PRICE_TAGS = [
        'АИ-92' => ['fuel:octane_92:price', 'price:octane_92', 'price:ron92'],
        'АИ-95' => ['fuel:octane_95:price', 'price:octane_95', 'price:ron95'],
        'АИ-98' => ['fuel:octane_98:price', 'price:octane_98', 'price:ron98'],
        'АИ-100' => ['fuel:octane_100:price', 'price:octane_100', 'price:ron100'],
        'ДТ' => ['fuel:diesel:price', 'price:diesel'],
        'Газ' => ['fuel:lpg:price', 'price:lpg'],
    ];

    private const PETROL_TAGS = [
        'fuel:octane_80',
        'fuel:octane_91',
        'fuel:octane_92',
        'fuel:octane_93',
        'fuel:octane_95',
        'fuel:octane_98',
        'fuel:octane_100',
    ];

    public function stationsForBounds(float $west, float $south, float $east, float $north): array
    {
        $tomTomApiKey = trim((string) config('services.tomtom_traffic.key'));
        $result = null;
        $officialStations = [];

        try {
            $officialStations = $this->officialPrices->stationsForBounds($west, $south, $east, $north);
        } catch (Throwable) {
            // Public map providers can still populate the layer.
        }

        if ($tomTomApiKey !== '') {
            try {
                $tomTomStations = $this->fetchTomTomStations($west, $south, $east, $north, $tomTomApiKey);

                if (count($tomTomStations) >= 40) {
                    $result = [
                        'data' => $tomTomStations,
                        'source' => 'TomTom',
                    ];
                } else {
                    try {
                        $openStreetMapStations = $this->fetchOpenStreetMapStations($west, $south, $east, $north);

                        $result = [
                            'data' => $this->mergeStations($tomTomStations, $openStreetMapStations),
                            'source' => 'TomTom + OpenStreetMap',
                        ];
                    } catch (Throwable) {
                        // TomTom stations are still useful if the supplemental source is unavailable.
                    }
                }

                $result ??= [
                    'data' => $tomTomStations,
                    'source' => 'TomTom',
                ];
            } catch (Throwable) {
                // OpenStreetMap keeps the layer useful when TomTom Search or Fuel Prices is unavailable.
            }
        }

        if ($result === null) {
            try {
                $result = [
                    'data' => $this->fetchOpenStreetMapStations($west, $south, $east, $north),
                    'source' => 'OpenStreetMap',
                ];
            } catch (Throwable $exception) {
                if ($officialStations === []) {
                    throw $exception;
                }

                $result = [
                    'data' => [],
                    'source' => '',
                ];
            }
        }

        if ($officialStations !== []) {
            $result['data'] = $this->mergeOfficialPrices($result['data'], $officialStations);
            $result['source'] = trim($result['source'].' + источники цен АЗС', ' +');
        }

        return $result;
    }

    public function stationsForBoundsFast(float $west, float $south, float $east, float $north): array
    {
        $tomTomApiKey = trim((string) config('services.tomtom_traffic.key'));

        if ($tomTomApiKey === '') {
            return [
                'data' => [],
                'source' => 'Быстрый источник недоступен',
            ];
        }

        return [
            'data' => $this->fetchTomTomStationLocations($west, $south, $east, $north, $tomTomApiKey),
            'source' => 'TomTom',
        ];
    }

    private function mergeOfficialPrices(array $stations, array $officialStations): array
    {
        $merged = collect($stations)->values();

        foreach ($officialStations as $officialStation) {
            $matchIndex = $merged->search(
                fn (array $station): bool => $this->distanceMeters(
                    (float) $station['latitude'],
                    (float) $station['longitude'],
                    (float) $officialStation['latitude'],
                    (float) $officialStation['longitude']
                ) <= 150
            );

            if ($matchIndex === false) {
                $merged->push($officialStation);

                continue;
            }

            $station = $merged->get($matchIndex);
            $officialPrices = (array) ($officialStation['prices'] ?? []);
            $stationPrices = (array) ($station['prices'] ?? []);

            $mergedStation = [
                ...$station,
                'name' => $officialStation['name'] ?: $station['name'],
                'brand' => $officialStation['brand'] ?: $station['brand'],
                'address' => $officialStation['address'] ?: $station['address'],
                'prices' => $officialPrices !== [] ? $officialPrices : $stationPrices,
                'priceLabel' => $officialPrices !== []
                    ? $officialStation['priceLabel']
                    : ($station['priceLabel'] ?? ''),
                'updatedAt' => $officialPrices !== []
                    ? $officialStation['updatedAt']
                    : ($station['updatedAt'] ?? null),
                'osmUrl' => $officialStation['osmUrl'] ?: ($station['osmUrl'] ?? ''),
                'priceSource' => $officialPrices !== []
                    ? $officialStation['priceSource']
                    : ($station['priceSource'] ?? ''),
            ];

            foreach (['availableFuelTypes', 'fuelAvailabilitySource', 'fuelAvailabilityUpdatedAt'] as $key) {
                if (! empty($officialStation[$key])) {
                    $mergedStation[$key] = $officialStation[$key];
                }
            }

            $merged->put($matchIndex, $mergedStation);
        }

        return $merged->values()->all();
    }

    private function mergeStations(array $tomTomStations, array $openStreetMapStations): array
    {
        $merged = collect($tomTomStations)->values();

        foreach ($openStreetMapStations as $openStreetMapStation) {
            $matchIndex = $merged->search(
                fn (array $tomTomStation): bool => $this->distanceMeters(
                    (float) $tomTomStation['latitude'],
                    (float) $tomTomStation['longitude'],
                    (float) $openStreetMapStation['latitude'],
                    (float) $openStreetMapStation['longitude']
                ) <= 120
            );

            if ($matchIndex === false) {
                $merged->push($openStreetMapStation);

                continue;
            }

            $tomTomStation = $merged->get($matchIndex);
            $tomTomPrices = (array) ($tomTomStation['prices'] ?? []);
            $openStreetMapPrices = (array) ($openStreetMapStation['prices'] ?? []);
            $prices = $tomTomPrices !== [] ? $tomTomPrices : $openStreetMapPrices;

            $merged->put($matchIndex, [
                ...$tomTomStation,
                'availability' => 'unknown',
                'prices' => $prices,
                'priceLabel' => $this->primaryPriceLabel($prices),
                'updatedAt' => $tomTomStation['updatedAt'] ?? $openStreetMapStation['updatedAt'],
                'osmUrl' => $openStreetMapStation['osmUrl'] ?? $tomTomStation['osmUrl'],
            ]);
        }

        return $merged->values()->all();
    }

    private function distanceMeters(float $latitudeA, float $longitudeA, float $latitudeB, float $longitudeB): float
    {
        $earthRadius = 6371000;
        $latitudeDelta = deg2rad($latitudeB - $latitudeA);
        $longitudeDelta = deg2rad($longitudeB - $longitudeA);
        $a = sin($latitudeDelta / 2) ** 2
            + cos(deg2rad($latitudeA)) * cos(deg2rad($latitudeB)) * sin($longitudeDelta / 2) ** 2;

        return $earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    private function fetchTomTomStations(
        float $west,
        float $south,
        float $east,
        float $north,
        string $apiKey
    ): array {
        $stations = collect($this->fetchTomTomStationLocations($west, $south, $east, $north, $apiKey));
        $priceIds = $stations
            ->pluck('fuelPriceId', 'id')
            ->filter()
            ->all();
        $prices = $this->fetchTomTomPrices($priceIds, $apiKey);

        return $stations
            ->map(function (array $station) use ($prices): array {
                $priceData = $prices[$station['id']] ?? ['prices' => [], 'updatedAt' => null];
                $station['prices'] = $priceData['prices'];
                $station['priceLabel'] = $this->primaryPriceLabel($station['prices']);
                $station['updatedAt'] = $priceData['updatedAt'];
                $station['priceSource'] = $station['prices'] !== [] ? 'TomTom Fuel Prices' : '';
                unset($station['fuelPriceId']);

                return $station;
            })
            ->all();
    }

    private function fetchTomTomStationLocations(
        float $west,
        float $south,
        float $east,
        float $north,
        string $apiKey
    ): array {
        $payload = Cache::remember(
            'fuel-stations:tomtom-search:'.sha1(implode(':', [$west, $south, $east, $north])),
            now()->addMinutes(10),
            fn () => Http::connectTimeout(3)
                ->timeout(7)
                ->acceptJson()
                ->get('https://api.tomtom.com/search/2/categorySearch/petrol%20station.json', [
                    'key' => $apiKey,
                    'topLeft' => "{$north},{$west}",
                    'btmRight' => "{$south},{$east}",
                    'limit' => 100,
                    'language' => 'ru-RU',
                    'view' => 'Unified',
                    'openingHours' => 'nextSevenDays',
                ])
                ->throw()
                ->json()
        );

        return collect((array) data_get($payload, 'results', []))
            ->map(fn (array $item): ?array => $this->normalizeTomTomStation($item))
            ->filter()
            ->values()
            ->all();
    }

    private function fetchTomTomPrices(array $priceIds, string $apiKey): array
    {
        if ($priceIds === []) {
            return [];
        }

        $cached = [];
        $missing = [];

        foreach ($priceIds as $stationId => $priceId) {
            $value = Cache::get("fuel-stations:tomtom-price:{$priceId}");
            if (is_array($value)) {
                $cached[$stationId] = $value;
            } else {
                $missing[$stationId] = $priceId;
            }
        }

        if ($missing === []) {
            return $cached;
        }

        $responses = Http::pool(function (Pool $pool) use ($missing, $apiKey): void {
            foreach ($missing as $stationId => $priceId) {
                $pool->as((string) $stationId)
                    ->connectTimeout(4)
                    ->timeout(10)
                    ->acceptJson()
                    ->withHeaders(['TomTom-Api-Version' => '1'])
                    ->get('https://api.tomtom.com/search/2/fuelPrice.json', [
                        'key' => $apiKey,
                        'fuelPrice' => $priceId,
                    ]);
            }
        }, 8);

        foreach ($responses as $stationId => $response) {
            if (! $response instanceof Response || ! $response->successful()) {
                continue;
            }

            $normalized = $this->normalizeTomTomPrices($response->json());
            $cached[(string) $stationId] = $normalized;
            Cache::put(
                'fuel-stations:tomtom-price:'.$missing[$stationId],
                $normalized,
                now()->addMinutes(10)
            );
        }

        return $cached;
    }

    private function normalizeTomTomStation(array $item): ?array
    {
        $latitude = data_get($item, 'position.lat');
        $longitude = data_get($item, 'position.lon');

        if (! is_numeric($latitude) || ! is_numeric($longitude)) {
            return null;
        }

        $id = (string) data_get($item, 'id', "{$longitude}:{$latitude}");

        return [
            'id' => 'tomtom-'.$id,
            'name' => data_get($item, 'poi.name') ?: 'АЗС',
            'brand' => data_get($item, 'poi.brands.0.name', ''),
            'address' => data_get($item, 'address.freeformAddress', ''),
            'latitude' => (float) $latitude,
            'longitude' => (float) $longitude,
            'availability' => 'unknown',
            'prices' => [],
            'priceLabel' => 'Цена не опубликована',
            'openingHours' => $this->formatTomTomOpeningHours((array) data_get($item, 'poi.openingHours', [])),
            'updatedAt' => null,
            'osmUrl' => sprintf('https://www.tomtom.com/mapshare/tools/new/mapshare/#loc=%.6F,%.6F', $latitude, $longitude),
            'fuelPriceId' => data_get($item, 'dataSources.fuelPrice.id'),
            'priceSource' => '',
        ];
    }

    private function normalizeTomTomPrices(array $payload): array
    {
        $updatedAt = null;
        $prices = collect((array) data_get($payload, 'fuels', []))
            ->mapWithKeys(function (array $fuel) use (&$updatedAt): array {
                $price = (array) data_get($fuel, 'price.0', []);
                $value = data_get($price, 'value');
                if (! is_numeric($value)) {
                    return [];
                }

                $type = (string) data_get($fuel, 'type', '');
                $label = self::TOMTOM_FUEL_TYPES[$type] ?? mb_strtoupper($type);
                $symbol = (string) data_get($price, 'currencySymbol', data_get($price, 'currency', ''));
                $fuelUpdatedAt = data_get($fuel, 'updatedAt');
                if (is_string($fuelUpdatedAt) && ($updatedAt === null || $fuelUpdatedAt > $updatedAt)) {
                    $updatedAt = $fuelUpdatedAt;
                }

                return [$label => number_format((float) $value, 2, ',', '')." {$symbol}"];
            })
            ->all();

        return compact('prices', 'updatedAt');
    }

    private function formatTomTomOpeningHours(array $openingHours): string
    {
        $ranges = (array) data_get($openingHours, 'timeRanges', []);
        if ($ranges === []) {
            return '';
        }

        $first = (array) $ranges[0];
        $start = data_get($first, 'startTime');
        $end = data_get($first, 'endTime');

        if (! is_array($start) || ! is_array($end)) {
            return '';
        }

        return sprintf(
            '%02d:%02d–%02d:%02d',
            (int) data_get($start, 'hour'),
            (int) data_get($start, 'minute'),
            (int) data_get($end, 'hour'),
            (int) data_get($end, 'minute')
        );
    }

    private function fetchOpenStreetMapStations(float $west, float $south, float $east, float $north): array
    {
        $bbox = sprintf('(%.6F,%.6F,%.6F,%.6F)', $south, $west, $north, $east);
        $query = <<<OVERPASS
            [out:json][timeout:20];
            (
              node["amenity"="fuel"]{$bbox};
              way["amenity"="fuel"]{$bbox};
              relation["amenity"="fuel"]{$bbox};
            );
            out center tags meta qt 1200;
            OVERPASS;

        $payload = Cache::remember(
            'fuel-stations:overpass:'.sha1($query),
            now()->addMinutes(10),
            fn () => $this->fetchOverpassPayload($query)
        );

        return collect((array) data_get($payload, 'elements', []))
            ->map(fn (array $item): ?array => $this->normalizeStation($item))
            ->filter()
            ->values()
            ->all();
    }

    private function fetchOverpassPayload(string $query): array
    {
        $lastException = null;

        foreach ([
            'https://overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter',
        ] as $endpoint) {
            try {
                return Http::connectTimeout(6)
                    ->timeout(26)
                    ->withoutVerifying()
                    ->withHeaders([
                        'Accept' => 'application/json',
                        'User-Agent' => 'AuralithMaps/1.0',
                    ])
                    ->asForm()
                    ->post($endpoint, ['data' => $query])
                    ->throw()
                    ->json();
            } catch (Throwable $exception) {
                $lastException = $exception;
            }
        }

        throw $lastException ?? new \RuntimeException('Fuel station provider is unavailable.');
    }

    private function normalizeStation(array $item): ?array
    {
        $tags = (array) data_get($item, 'tags', []);
        $latitude = data_get($item, 'lat') ?? data_get($item, 'center.lat');
        $longitude = data_get($item, 'lon') ?? data_get($item, 'center.lon');

        if (! is_numeric($latitude) || ! is_numeric($longitude)) {
            return null;
        }

        $prices = collect(self::PRICE_TAGS)
            ->mapWithKeys(function (array $keys, string $label) use ($tags): array {
                foreach ($keys as $key) {
                    $price = $this->normalizePrice($tags[$key] ?? null);
                    if ($price !== null) {
                        return [$label => $price];
                    }
                }

                return [];
            })
            ->all();

        return [
            'id' => sprintf('%s-%s', data_get($item, 'type', 'node'), data_get($item, 'id')),
            'name' => $tags['name'] ?? $tags['brand'] ?? $tags['operator'] ?? 'АЗС',
            'brand' => $tags['brand'] ?? $tags['operator'] ?? '',
            'address' => $this->formatAddress($tags),
            'latitude' => (float) $latitude,
            'longitude' => (float) $longitude,
            'availability' => 'unknown',
            'prices' => $prices,
            'priceLabel' => $this->primaryPriceLabel($prices),
            'openingHours' => $tags['opening_hours'] ?? '',
            'updatedAt' => data_get($item, 'timestamp'),
            'osmUrl' => sprintf(
                'https://www.openstreetmap.org/%s/%s',
                data_get($item, 'type', 'node'),
                data_get($item, 'id')
            ),
            'priceSource' => $prices !== [] ? 'Открытые данные OpenStreetMap' : '',
        ];
    }

    private function normalizePrice(mixed $value): ?string
    {
        if (! is_scalar($value)) {
            return null;
        }

        $normalized = trim(str_replace(',', '.', (string) $value));
        if (! preg_match('/\d+(?:\.\d{1,2})?/', $normalized, $matches)) {
            return null;
        }

        $price = (float) $matches[0];
        if ($price <= 0 || $price > 500) {
            return null;
        }

        return number_format($price, $price === floor($price) ? 0 : 2, ',', '').' ₽';
    }

    private function primaryPriceLabel(array $prices): string
    {
        foreach (['АИ-95', 'АИ-92', 'ДТ', 'АИ-98', 'АИ-100', 'Газ'] as $fuel) {
            if (isset($prices[$fuel])) {
                return "{$fuel} · {$prices[$fuel]}";
            }
        }

        return 'Цена не опубликована';
    }

    private function formatAddress(array $tags): string
    {
        if (! empty($tags['addr:full'])) {
            return (string) $tags['addr:full'];
        }

        $street = trim(implode(' ', array_filter([
            $tags['addr:street'] ?? null,
            $tags['addr:housenumber'] ?? null,
        ])));

        return implode(', ', array_filter([
            $street,
            $tags['addr:city'] ?? null,
        ]));
    }
}
