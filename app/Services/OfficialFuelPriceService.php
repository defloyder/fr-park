<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class OfficialFuelPriceService
{
    public function stationsForBounds(float $west, float $south, float $east, float $north): array
    {
        $stations = [];

        try {
            $stations = array_merge($stations, $this->tatneftStations($west, $south, $east, $north));
        } catch (\Throwable) {
            // One network must not prevent another official source from enriching prices.
        }

        try {
            $stations = array_merge($stations, $this->neftmagistralStations($west, $south, $east, $north));
        } catch (\Throwable) {
            // The main fuel layer remains available when the website changes or times out.
        }

        return $stations;
    }

    private function tatneftStations(float $west, float $south, float $east, float $north): array
    {
        [$stationsPayload, $fuelTypesPayload] = Cache::remember(
            'fuel-prices:official:tatneft',
            now()->addMinutes(10),
            fn (): array => [
                Http::connectTimeout(5)
                    ->timeout(20)
                    ->withoutVerifying()
                    ->acceptJson()
                    ->get('https://api.gs.cloud.tatneftm.ru/api/v2/azs/')
                    ->throw()
                    ->json(),
                Http::connectTimeout(5)
                    ->timeout(15)
                    ->withoutVerifying()
                    ->acceptJson()
                    ->get('https://api.gs.cloud.tatneftm.ru/api/v2/azs/fuel_types/')
                    ->throw()
                    ->json(),
            ]
        );

        $fuelTypes = collect((array) data_get($fuelTypesPayload, 'data.items', []))
            ->mapWithKeys(fn (array $fuel): array => [
                (int) data_get($fuel, 'id') => trim((string) data_get($fuel, 'title')),
            ]);

        return collect((array) data_get($stationsPayload, 'data', []))
            ->filter(function (array $station) use ($west, $south, $east, $north): bool {
                $latitude = (float) data_get($station, 'lat');
                $longitude = (float) data_get($station, 'lon');

                return $latitude >= $south
                    && $latitude <= $north
                    && $longitude >= $west
                    && $longitude <= $east;
            })
            ->map(function (array $station) use ($fuelTypes): ?array {
                $latitude = data_get($station, 'lat');
                $longitude = data_get($station, 'lon');

                if (! is_numeric($latitude) || ! is_numeric($longitude)) {
                    return null;
                }

                $updatedAt = null;
                $prices = collect((array) data_get($station, 'fuel', []))
                    ->mapWithKeys(function (array $fuel) use ($fuelTypes, &$updatedAt): array {
                        $value = data_get($fuel, 'price');
                        $typeId = (int) data_get($fuel, 'fuel_type_id');
                        $title = $fuelTypes->get($typeId);

                        if (! is_numeric($value) || ! is_string($title) || $title === '') {
                            return [];
                        }

                        $timestamp = data_get($fuel, 'updated');
                        if (is_numeric($timestamp) && ($updatedAt === null || (float) $timestamp > $updatedAt)) {
                            $updatedAt = (float) $timestamp;
                        }

                        return [$this->normalizeFuelTitle($title) => number_format((float) $value, 2, ',', '').' ₽'];
                    })
                    ->all();

                if ($prices === []) {
                    return null;
                }

                return [
                    'id' => 'tatneft-'.data_get($station, 'id'),
                    'name' => 'Татнефть №'.data_get($station, 'number'),
                    'brand' => 'Татнефть',
                    'address' => (string) data_get($station, 'address', ''),
                    'latitude' => (float) $latitude,
                    'longitude' => (float) $longitude,
                    'availability' => 'unknown',
                    'prices' => $prices,
                    'priceLabel' => $this->primaryPriceLabel($prices),
                    'openingHours' => '',
                    'updatedAt' => $updatedAt !== null ? gmdate(DATE_ATOM, (int) $updatedAt) : null,
                    'osmUrl' => 'https://azs.tatneft.ru/locator',
                    'priceSource' => 'Официальная карта АЗС «Татнефть»',
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    private function normalizeFuelTitle(string $title): string
    {
        $normalized = preg_replace('/\s+/u', ' ', trim($title)) ?: trim($title);

        return str_ireplace(['АИ ', 'аи '], 'АИ-', $normalized);
    }

    private function primaryPriceLabel(array $prices): string
    {
        foreach (['АИ-95', 'АИ-92', 'ДТ', 'ДТ Танеко', 'АИ-100', 'Газ'] as $fuel) {
            if (isset($prices[$fuel])) {
                return "{$fuel} · {$prices[$fuel]}";
            }
        }

        $fuel = array_key_first($prices);

        return $fuel !== null ? "{$fuel} · {$prices[$fuel]}" : 'Цена не опубликована';
    }

    private function neftmagistralStations(float $west, float $south, float $east, float $north): array
    {
        $html = Cache::remember(
            'fuel-prices:official:neftmagistral',
            now()->addMinutes(10),
            fn (): string => Http::connectTimeout(5)
                ->timeout(20)
                ->withoutVerifying()
                ->withHeaders(['User-Agent' => 'AuralithMaps/1.0'])
                ->get('https://neftm.ru/')
                ->throw()
                ->body()
        );

        $document = new \DOMDocument();
        $previous = libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="UTF-8">'.$html);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        $xpath = new \DOMXPath($document);
        $nodes = $xpath->query(
            '//div[contains(concat(" ", normalize-space(@class), " "), " map-filter__station-item ")]'
        );

        if ($nodes === false) {
            return [];
        }

        $stations = [];
        foreach ($nodes as $node) {
            if (! $node instanceof \DOMElement) {
                continue;
            }

            $latitude = $node->getAttribute('data-lat');
            $longitude = $node->getAttribute('data-lng');
            if (! is_numeric($latitude) || ! is_numeric($longitude)) {
                continue;
            }

            $latitude = (float) $latitude;
            $longitude = (float) $longitude;
            if ($latitude < $south || $latitude > $north || $longitude < $west || $longitude > $east) {
                continue;
            }

            $addressNode = $xpath->query(
                './/*[contains(concat(" ", normalize-space(@class), " "), " map-filter__station-address ")]',
                $node
            )?->item(0);
            $address = trim((string) $addressNode?->textContent);
            $prices = [];
            $priceNodes = $xpath->query(
                './/*[contains(concat(" ", normalize-space(@class), " "), " map-filter__fuel-price ")]',
                $node
            );

            if ($priceNodes !== false) {
                foreach ($priceNodes as $priceNode) {
                    $parts = $xpath->query('./p', $priceNode);
                    $fuel = trim((string) $parts?->item(0)?->textContent);
                    $value = trim((string) $parts?->item(1)?->textContent);

                    if ($fuel !== '' && is_numeric(str_replace(',', '.', $value))) {
                        $prices[$this->normalizeFuelTitle($fuel)] = number_format(
                            (float) str_replace(',', '.', $value),
                            2,
                            ',',
                            ''
                        ).' ₽';
                    }
                }
            }

            if ($prices === []) {
                continue;
            }

            $stationNumber = null;
            if (preg_match('/АЗС\s*([^\s.,]+)/ui', $address, $matches) === 1) {
                $stationNumber = $matches[1];
            }

            $stations[] = [
                'id' => 'neftmagistral-'.ltrim($node->getAttribute('id'), 'gs'),
                'name' => 'Нефтьмагистраль'.($stationNumber ? " №{$stationNumber}" : ''),
                'brand' => 'Нефтьмагистраль',
                'address' => $address,
                'latitude' => $latitude,
                'longitude' => $longitude,
                'availability' => 'unknown',
                'prices' => $prices,
                'priceLabel' => $this->primaryPriceLabel($prices),
                'openingHours' => '',
                'updatedAt' => null,
                'osmUrl' => 'https://neftm.ru/#gasstations',
                'priceSource' => 'Официальная карта АЗС «Нефтьмагистраль»',
            ];
        }

        return $stations;
    }
}
