<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class RoadDetailService
{
    public function featuresForBounds(array $bounds): array
    {
        $bbox = sprintf(
            '(%F,%F,%F,%F)',
            $bounds['south'],
            $bounds['west'],
            $bounds['north'],
            $bounds['east'],
        );

        $query = <<<OVERPASS
            [out:json][timeout:18];
            (
              node["highway"="traffic_signals"]{$bbox};
              node["highway"="crossing"]{$bbox};
              node["traffic_calming"~"^(bump|hump|table|cushion|yes)$"]{$bbox};
            )->.roadNodes;
            (
              .roadNodes;
              way(bn.roadNodes);
              way["highway"]["turn:lanes"]{$bbox};
              way["highway"]["turn:lanes:forward"]{$bbox};
              way["highway"]["turn:lanes:backward"]{$bbox};
              way["highway"]["maxspeed"]{$bbox};
              way["highway"]["parking:condition:left"~"no_parking|no_stopping|restricted"]{$bbox};
              way["highway"]["parking:condition:right"~"no_parking|no_stopping|restricted"]{$bbox};
              way["highway"]["parking:condition:both"~"no_parking|no_stopping|restricted"]{$bbox};
              way["highway"]["parking:left"~"no_parking|no_stopping|no"]{$bbox};
              way["highway"]["parking:right"~"no_parking|no_stopping|no"]{$bbox};
              way["highway"]["parking:both"~"no_parking|no_stopping|no"]{$bbox};
            );
            out body geom 700;
            OVERPASS;

        $payload = Cache::remember(
            'road-details:overpass:'.sha1($query),
            now()->addMinutes(30),
            fn () => Http::timeout(20)
                ->asForm()
                ->post('https://overpass-api.de/api/interpreter', ['data' => $query])
                ->throw()
                ->json(),
        );

        return $this->toGeoJsonFeatures((array) data_get($payload, 'elements', []));
    }

    private function toGeoJsonFeatures(array $elements): array
    {
        $nodeBearings = $this->nodeBearings($elements);

        return collect($elements)
            ->flatMap(fn (array $element) => $this->elementFeatures($element, $nodeBearings))
            ->values()
            ->all();
    }

    private function elementFeatures(array $element, array $nodeBearings): array
    {
        $tags = (array) ($element['tags'] ?? []);
        $id = (string) ($element['type'] ?? 'osm').'-'.($element['id'] ?? uniqid());

        if (($element['type'] ?? null) === 'node') {
            $longitude = $element['lon'] ?? null;
            $latitude = $element['lat'] ?? null;

            if (! is_numeric($longitude) || ! is_numeric($latitude)) {
                return [];
            }

            $detailType = match (true) {
                ($tags['highway'] ?? null) === 'traffic_signals' => 'traffic_signal',
                ($tags['highway'] ?? null) === 'crossing' => 'crossing',
                isset($tags['traffic_calming']) => 'speed_bump',
                default => null,
            };

            if ($detailType === null) {
                return [];
            }

            return [$this->feature($id, 'Point', [(float) $longitude, (float) $latitude], [
                'detailType' => $detailType,
                'crossingType' => $tags['crossing'] ?? '',
                'trafficCalming' => $tags['traffic_calming'] ?? '',
                'bearing' => $nodeBearings[(string) ($element['id'] ?? '')] ?? 0,
            ])];
        }

        $coordinates = collect((array) ($element['geometry'] ?? []))
            ->filter(fn ($point) => is_numeric($point['lon'] ?? null) && is_numeric($point['lat'] ?? null))
            ->map(fn ($point) => [(float) $point['lon'], (float) $point['lat']])
            ->values()
            ->all();

        if (count($coordinates) < 2) {
            return [];
        }

        $features = [];
        $maxspeed = $this->normalizeMaxspeed($tags['maxspeed'] ?? '');

        if ($maxspeed !== '') {
            $features[] = $this->feature($id.'-speed', 'LineString', $coordinates, [
                'detailType' => 'maxspeed',
                'maxspeed' => $maxspeed,
            ]);
        }

        foreach ($this->turnLaneFeatures($id, $coordinates, $tags) as $feature) {
            $features[] = $feature;
        }

        foreach (['left', 'right'] as $side) {
            if ($this->hasParkingRestriction($tags, $side)) {
                $features[] = $this->feature($id.'-parking-'.$side, 'LineString', $coordinates, [
                    'detailType' => 'parking_restriction',
                    'side' => $side,
                ]);
            }
        }

        if ($this->hasParkingRestriction($tags, 'both')) {
            foreach (['left', 'right'] as $side) {
                $features[] = $this->feature($id.'-parking-both-'.$side, 'LineString', $coordinates, [
                    'detailType' => 'parking_restriction',
                    'side' => $side,
                ]);
            }
        }

        return $features;
    }

    private function turnLaneFeatures(string $id, array $coordinates, array $tags): array
    {
        $features = [];
        $definitions = [
            ['tag' => 'turn:lanes:forward', 'direction' => 'forward'],
            ['tag' => 'turn:lanes:backward', 'direction' => 'backward'],
        ];

        if (isset($tags['turn:lanes'])
            && ! isset($tags['turn:lanes:forward'])
            && ! isset($tags['turn:lanes:backward'])) {
            $definitions[] = [
                'tag' => 'turn:lanes',
                'direction' => (string) ($tags['oneway'] ?? '') === '-1' ? 'backward' : 'forward',
            ];
        }

        foreach ($definitions as $definition) {
            $raw = trim((string) ($tags[$definition['tag']] ?? ''));
            if ($raw === '') {
                continue;
            }

            $lanes = collect(explode('|', $raw))
                ->map(fn ($lane) => collect(explode(';', (string) $lane))
                    ->map(fn ($turn) => $this->normalizeTurnLane($turn))
                    ->filter()
                    ->unique()
                    ->values()
                    ->all())
                ->values()
                ->all();

            if ($lanes === [] || ! collect($lanes)->contains(fn ($lane) => $lane !== [])) {
                continue;
            }

            $direction = $definition['direction'];
            $features[] = $this->feature(
                $id.'-turn-lanes-'.$direction,
                'LineString',
                $direction === 'backward' ? array_reverse($coordinates) : $coordinates,
                [
                    'detailType' => 'turn_lanes',
                    'turnLanes' => $lanes,
                ],
            );
        }

        return $features;
    }

    private function normalizeTurnLane(mixed $value): string
    {
        return match (mb_strtolower(trim((string) $value))) {
            'through' => 'through',
            'left' => 'left',
            'slight_left' => 'slight_left',
            'sharp_left' => 'sharp_left',
            'merge_to_left' => 'merge_to_left',
            'right' => 'right',
            'slight_right' => 'slight_right',
            'sharp_right' => 'sharp_right',
            'merge_to_right' => 'merge_to_right',
            'reverse' => 'reverse',
            default => '',
        };
    }

    private function hasParkingRestriction(array $tags, string $side): bool
    {
        $values = [
            $tags["parking:condition:{$side}"] ?? '',
            $tags["parking:{$side}"] ?? '',
        ];

        return collect($values)->contains(
            fn ($value) => preg_match('/no_parking|no_stopping|restricted|^no$/i', (string) $value) === 1,
        );
    }

    private function normalizeMaxspeed(mixed $value): string
    {
        if (preg_match('/\d{1,3}/', (string) $value, $matches) !== 1) {
            return '';
        }

        $speed = (int) $matches[0];

        return $speed >= 5 && $speed <= 180 ? (string) $speed : '';
    }

    private function feature(string $id, string $geometryType, array $coordinates, array $properties): array
    {
        return [
            'type' => 'Feature',
            'id' => $id,
            'geometry' => [
                'type' => $geometryType,
                'coordinates' => $coordinates,
            ],
            'properties' => $properties,
        ];
    }

    private function nodeBearings(array $elements): array
    {
        $bearings = [];

        foreach ($elements as $element) {
            $nodes = array_values((array) ($element['nodes'] ?? []));
            $geometry = array_values((array) ($element['geometry'] ?? []));

            if (count($nodes) < 2 || count($nodes) !== count($geometry)) {
                continue;
            }

            foreach ($nodes as $index => $nodeId) {
                $start = $geometry[max(0, $index - 1)] ?? null;
                $finish = $geometry[min(count($geometry) - 1, $index + 1)] ?? null;

                if (! is_numeric($start['lat'] ?? null)
                    || ! is_numeric($start['lon'] ?? null)
                    || ! is_numeric($finish['lat'] ?? null)
                    || ! is_numeric($finish['lon'] ?? null)) {
                    continue;
                }

                $bearings[(string) $nodeId] = $this->bearing(
                    (float) $start['lat'],
                    (float) $start['lon'],
                    (float) $finish['lat'],
                    (float) $finish['lon'],
                );
            }
        }

        return $bearings;
    }

    private function bearing(float $startLatitude, float $startLongitude, float $endLatitude, float $endLongitude): float
    {
        $startLat = deg2rad($startLatitude);
        $endLat = deg2rad($endLatitude);
        $longitudeDelta = deg2rad($endLongitude - $startLongitude);
        $y = sin($longitudeDelta) * cos($endLat);
        $x = cos($startLat) * sin($endLat)
            - sin($startLat) * cos($endLat) * cos($longitudeDelta);

        return fmod(rad2deg(atan2($y, $x)) + 360, 360);
    }
}
