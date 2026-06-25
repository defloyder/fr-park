<?php

namespace App\Services;

use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
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

        try {
            $stations = array_merge($stations, $this->gazpromneftStations($west, $south, $east, $north));
        } catch (\Throwable) {
            // Keep other official sources available if the station API is temporarily unavailable.
        }

        try {
            $stations = array_merge($stations, $this->rosneftStations($west, $south, $east, $north));
        } catch (\Throwable) {
            // Rosneft embeds the public station data in its page, which can change independently.
        }

        return $stations;
    }

    private function gazpromneftStations(float $west, float $south, float $east, float $north): array
    {
        $payload = Cache::remember(
            'fuel-prices:official:gazpromneft:list',
            now()->addMinutes(10),
            fn (): array => Http::connectTimeout(5)
                ->timeout(25)
                ->withoutVerifying()
                ->acceptJson()
                ->withHeaders(['User-Agent' => 'Mozilla/5.0 AuralithMaps/1.0'])
                ->withBody('{}', 'application/json')
                ->post('https://gpnbonus.ru/api/stations/list')
                ->throw()
                ->json()
        );

        $stations = collect((array) data_get($payload, 'stations', []))
            ->filter(function (array $station) use ($west, $south, $east, $north): bool {
                $latitude = data_get($station, 'latitude');
                $longitude = data_get($station, 'longitude');

                return is_numeric($latitude)
                    && is_numeric($longitude)
                    && (float) $latitude >= $south
                    && (float) $latitude <= $north
                    && (float) $longitude >= $west
                    && (float) $longitude <= $east;
            })
            ->take(120)
            ->values();

        if ($stations->isEmpty()) {
            return [];
        }

        $details = [];
        $missing = [];

        foreach ($stations as $station) {
            $stationId = (string) data_get($station, 'GPNAZSID');
            if ($stationId === '') {
                continue;
            }

            $cached = Cache::get("fuel-prices:official:gazpromneft:station:{$stationId}");
            if (is_array($cached)) {
                $details[$stationId] = $cached;
            } else {
                $missing[$stationId] = $stationId;
            }
        }

        if ($missing !== []) {
            $responses = Http::pool(function (Pool $pool) use ($missing): void {
                foreach ($missing as $stationId) {
                    $pool->as($stationId)
                        ->connectTimeout(4)
                        ->timeout(10)
                        ->withoutVerifying()
                        ->acceptJson()
                        ->withHeaders(['User-Agent' => 'Mozilla/5.0 AuralithMaps/1.0'])
                        ->withBody('{}', 'application/json')
                        ->post("https://gpnbonus.ru/api/stations/{$stationId}");
                }
            }, 8);

            foreach ($responses as $stationId => $response) {
                if (! $response instanceof Response || ! $response->successful()) {
                    continue;
                }

                $detail = (array) $response->json();
                $details[(string) $stationId] = $detail;
                Cache::put(
                    "fuel-prices:official:gazpromneft:station:{$stationId}",
                    $detail,
                    now()->addMinutes(10)
                );
            }
        }

        return $stations
            ->map(function (array $station) use ($details): ?array {
                $stationId = (string) data_get($station, 'GPNAZSID');
                $updatedAt = null;
                $prices = collect((array) data_get($details[$stationId] ?? [], 'data', []))
                    ->mapWithKeys(function (array $fuel) use (&$updatedAt): array {
                        $value = data_get($fuel, 'price.price');
                        $title = $this->gazpromneftFuelTitle($fuel);
                        if (! is_numeric($value) || $title === '') {
                            return [];
                        }

                        $timestamp = data_get($fuel, 'price.since');
                        if (is_string($timestamp) && ($updatedAt === null || $timestamp > $updatedAt)) {
                            $updatedAt = $timestamp;
                        }

                        return [$title => number_format((float) $value, 2, ',', '').' ₽'];
                    })
                    ->all();

                if ($prices === []) {
                    return null;
                }

                return [
                    'id' => 'gazpromneft-'.$stationId,
                    'name' => trim('Газпромнефть '.(string) data_get($station, 'name')),
                    'brand' => 'Газпромнефть',
                    'address' => implode(', ', array_filter([
                        data_get($station, 'city'),
                        data_get($station, 'address'),
                    ])),
                    'latitude' => (float) data_get($station, 'latitude'),
                    'longitude' => (float) data_get($station, 'longitude'),
                    'availability' => 'unknown',
                    'prices' => $prices,
                    'priceLabel' => $this->primaryPriceLabel($prices),
                    'openingHours' => (string) data_get($station, 'workMode', ''),
                    'updatedAt' => $updatedAt,
                    'osmUrl' => 'https://gpnbonus.ru/fuel/refuel-map',
                    'priceSource' => 'Официальная карта АЗС «Газпромнефть»',
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    private function gazpromneftFuelTitle(array $fuel): string
    {
        $shortTitle = mb_strtoupper(trim((string) data_get($fuel, 'product.shortTitle', '')));

        if (preg_match('/^(?:АИ-?)?(\d{2,3})$/u', $shortTitle, $matches) === 1) {
            return 'АИ-'.$matches[1];
        }

        if (str_starts_with($shortTitle, 'ДТ')) {
            return $shortTitle === 'ДТ' ? 'ДТ' : $shortTitle;
        }

        return $this->normalizeFuelTitle(
            $shortTitle !== '' ? $shortTitle : (string) data_get($fuel, 'product.title', '')
        );
    }

    private function rosneftStations(float $west, float $south, float $east, float $north): array
    {
        $html = Cache::remember(
            'fuel-prices:official:rosneft',
            now()->addMinutes(10),
            fn (): string => Http::connectTimeout(5)
                ->timeout(30)
                ->withoutVerifying()
                ->withHeaders(['User-Agent' => 'AuralithMaps/1.0'])
                ->get('https://rosneft-azs.ru/stations')
                ->throw()
                ->body()
        );

        $scriptStart = strpos($html, 'window.__NUXT__=');
        if ($scriptStart === false) {
            return [];
        }

        $scriptEnd = strpos($html, '</script>', $scriptStart);
        $script = substr($html, $scriptStart, $scriptEnd === false ? null : $scriptEnd - $scriptStart);
        if (
            preg_match(
                '/window\.__NUXT__=\(function\((?<params>.*?)\)\{(?<body>.*)\}\((?<args>.*)\)\)\s*;?\s*$/s',
                $script,
                $matches
            ) !== 1
        ) {
            return [];
        }

        $parameters = array_map('trim', explode(',', $matches['params']));
        $arguments = $this->splitJavascriptList($matches['args']);
        $values = [];

        foreach ($parameters as $index => $parameter) {
            $values[$parameter] = $this->decodeJavascriptValue($arguments[$index] ?? 'undefined');
        }

        $stationMarker = 'stations:{stations:[';
        $stationMarkerPosition = strpos($matches['body'], $stationMarker);
        if ($stationMarkerPosition === false) {
            return [];
        }

        $metadataBody = substr($matches['body'], 0, $stationMarkerPosition);
        $fuelLabels = [];
        if (
            preg_match_all(
                '/\b([A-Za-z_$][A-Za-z0-9_$]*)\.(?:label|shortLabel)=([^;]+);/',
                $metadataBody,
                $labelMatches,
                PREG_SET_ORDER
            )
        ) {
            foreach ($labelMatches as $labelMatch) {
                $label = $this->resolveJavascriptToken($labelMatch[2], $values);
                if (is_string($label) && trim($label) !== '') {
                    $fuelLabels[$labelMatch[1]] = $this->normalizeFuelTitle($label);
                }
            }
        }

        $openingBracket = $stationMarkerPosition + strlen($stationMarker) - 1;
        $stationList = $this->extractJavascriptDelimited(
            $matches['body'],
            $openingBracket,
            '[',
            ']'
        );
        if ($stationList === null) {
            return [];
        }

        $stations = [];
        foreach ($this->splitJavascriptList($stationList) as $stationObject) {
            if (
                preg_match(
                    '/^\{id:([^,]+),title:("(?:\\\\.|[^"])*"|[A-Za-z_$][A-Za-z0-9_$]*),'
                    .'address:("(?:\\\\.|[^"])*"|[A-Za-z_$][A-Za-z0-9_$]*),brand:([^,]+),'
                    .'currency:[^,]+,type:[^,]+,region:[^,]+,coords:\{lat:([^,]+),lng:([^}]+)\}'
                    .'.*?,fuels:\[(.*?)\],services:/s',
                    trim($stationObject),
                    $stationMatch
                ) !== 1
            ) {
                continue;
            }

            $latitude = $this->resolveJavascriptToken($stationMatch[5], $values);
            $longitude = $this->resolveJavascriptToken($stationMatch[6], $values);
            if (
                ! is_numeric($latitude)
                || ! is_numeric($longitude)
                || (float) $latitude < $south
                || (float) $latitude > $north
                || (float) $longitude < $west
                || (float) $longitude > $east
            ) {
                continue;
            }

            $prices = [];
            if (
                preg_match_all(
                    '/\{id:([^,}]+),price:([^,}]+),info:([^}]+)\}/',
                    $stationMatch[7],
                    $fuelMatches,
                    PREG_SET_ORDER
                )
            ) {
                foreach ($fuelMatches as $fuelMatch) {
                    $price = $this->resolveJavascriptToken($fuelMatch[2], $values);
                    $infoVariable = trim($fuelMatch[3]);
                    $label = $fuelLabels[$infoVariable] ?? null;

                    if (is_numeric($price) && (float) $price > 0 && is_string($label) && $label !== '') {
                        $prices[$label] = number_format((float) $price, 2, ',', '').' ₽';
                    }
                }
            }

            if ($prices === []) {
                continue;
            }

            $brandCode = $this->resolveJavascriptToken($stationMatch[4], $values);
            $brand = $this->rosneftBrandName(is_string($brandCode) ? $brandCode : '');
            $title = (string) $this->resolveJavascriptToken($stationMatch[2], $values);
            $address = (string) $this->resolveJavascriptToken($stationMatch[3], $values);
            $id = $this->resolveJavascriptToken($stationMatch[1], $values);

            $stations[] = [
                'id' => 'rosneft-'.$id,
                'name' => $this->rosneftStationName($title, $brand),
                'brand' => $brand,
                'address' => $address,
                'latitude' => (float) $latitude,
                'longitude' => (float) $longitude,
                'availability' => 'unknown',
                'prices' => $prices,
                'priceLabel' => $this->primaryPriceLabel($prices),
                'openingHours' => '',
                'updatedAt' => null,
                'osmUrl' => 'https://rosneft-azs.ru/stations',
                'priceSource' => 'Официальная карта АЗС «Роснефть»',
            ];
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
        foreach (['АИ-95', 'G-95', 'АИ-92', 'ДТ', 'ДТ Танеко', 'АИ-100', 'Газ'] as $fuel) {
            if (isset($prices[$fuel])) {
                return "{$fuel} · {$prices[$fuel]}";
            }
        }

        $fuel = array_key_first($prices);

        return $fuel !== null ? "{$fuel} · {$prices[$fuel]}" : 'Цена не опубликована';
    }

    private function splitJavascriptList(string $source): array
    {
        $items = [];
        $start = 0;
        $length = strlen($source);
        $stack = [];
        $quote = null;
        $escaped = false;

        for ($index = 0; $index < $length; $index++) {
            $character = $source[$index];

            if ($quote !== null) {
                if ($escaped) {
                    $escaped = false;
                } elseif ($character === '\\') {
                    $escaped = true;
                } elseif ($character === $quote) {
                    $quote = null;
                }

                continue;
            }

            if ($character === '"' || $character === "'") {
                $quote = $character;

                continue;
            }

            if ($character === '(' || $character === '[' || $character === '{') {
                $stack[] = $character;

                continue;
            }

            if ($character === ')' || $character === ']' || $character === '}') {
                array_pop($stack);

                continue;
            }

            if ($character === ',' && $stack === []) {
                $items[] = trim(substr($source, $start, $index - $start));
                $start = $index + 1;
            }
        }

        $last = trim(substr($source, $start));
        if ($last !== '' || $source !== '') {
            $items[] = $last;
        }

        return $items;
    }

    private function extractJavascriptDelimited(
        string $source,
        int $openingPosition,
        string $openingCharacter,
        string $closingCharacter
    ): ?string {
        if (($source[$openingPosition] ?? null) !== $openingCharacter) {
            return null;
        }

        $depth = 1;
        $quote = null;
        $escaped = false;
        $length = strlen($source);

        for ($index = $openingPosition + 1; $index < $length; $index++) {
            $character = $source[$index];

            if ($quote !== null) {
                if ($escaped) {
                    $escaped = false;
                } elseif ($character === '\\') {
                    $escaped = true;
                } elseif ($character === $quote) {
                    $quote = null;
                }

                continue;
            }

            if ($character === '"' || $character === "'") {
                $quote = $character;
            } elseif ($character === $openingCharacter) {
                $depth++;
            } elseif ($character === $closingCharacter) {
                $depth--;
                if ($depth === 0) {
                    return substr($source, $openingPosition + 1, $index - $openingPosition - 1);
                }
            }
        }

        return null;
    }

    private function decodeJavascriptValue(string $token): mixed
    {
        $token = trim($token);
        if ($token === 'null' || $token === 'undefined') {
            return null;
        }

        if ($token === 'true') {
            return true;
        }

        if ($token === 'false') {
            return false;
        }

        if (is_numeric($token)) {
            return str_contains($token, '.') ? (float) $token : (int) $token;
        }

        if (str_starts_with($token, '"')) {
            $decoded = json_decode($token, true);

            return is_string($decoded) ? $decoded : null;
        }

        return $token === '{}' ? [] : null;
    }

    private function resolveJavascriptToken(string $token, array $values): mixed
    {
        $token = trim($token);

        return array_key_exists($token, $values)
            ? $values[$token]
            : $this->decodeJavascriptValue($token);
    }

    private function rosneftBrandName(string $brandCode): string
    {
        return match (mb_strtolower($brandCode)) {
            'bashneft' => 'Башнефть',
            'tnk' => 'ТНК',
            'slavneft' => 'Славнефть',
            default => 'Роснефть',
        };
    }

    private function rosneftStationName(string $title, string $brand): string
    {
        if (preg_match('/АЗС\s*(?:№\s*)?[A-Za-zА-Яа-я0-9-]+/u', $title, $matches) === 1) {
            return "{$brand} · {$matches[0]}";
        }

        return $brand;
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

        $document = new \DOMDocument;
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
