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
              way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]["lanes"]{$bbox};
              way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]["lanes:forward"]{$bbox};
              way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]["lanes:backward"]{$bbox};
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
            out body geom;
            OVERPASS;

        $payload = Cache::remember(
            'road-details:overpass:'.sha1($query),
            now()->addMinutes(30),
            fn () => $this->fetchOverpass($query),
        );

        return $this->toGeoJsonFeatures((array) data_get($payload, 'elements', []));
    }

    private function fetchOverpass(string $query): array
    {
        $lastException = null;

        foreach ([
            'https://overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter',
        ] as $endpoint) {
            try {
                return Http::withHeaders([
                    'Accept' => 'application/json',
                    'User-Agent' => 'Auralith-Maps/1.0',
                ])
                    ->connectTimeout(5)
                    ->timeout(24)
                    ->get($endpoint, ['data' => $query])
                    ->throw()
                    ->json();
            } catch (\Throwable $exception) {
                $lastException = $exception;
            }
        }

        throw $lastException ?? new \RuntimeException('Overpass request failed.');
    }

    private function toGeoJsonFeatures(array $elements): array
    {
        $nodeBearings = $this->nodeBearings($elements);

        $features = collect($elements)
            ->flatMap(fn (array $element) => $this->elementFeatures($element, $nodeBearings))
            ->values()
            ->all();

        return array_merge($features, $this->roadGoreFeatures($elements));
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
        $laneCount = $this->laneCount($tags);

        if ($laneCount !== null) {
            $directionBoundary = $this->directionBoundary($tags, $laneCount);
            $roadCoordinates = (string) ($tags['oneway'] ?? '') === '-1'
                ? array_reverse($coordinates)
                : $coordinates;
            $roadProperties = [
                'detailType' => 'road_geometry',
                'roadClass' => $this->normalizeRoadClass($tags['highway'] ?? ''),
                'laneCount' => $laneCount,
                'oneway' => $this->isOneway($tags),
                'directionBoundary' => $directionBoundary,
                'name' => trim((string) ($tags['name'] ?? '')),
                'ref' => trim((string) ($tags['ref'] ?? '')),
                'bridge' => isset($tags['bridge']) && $tags['bridge'] !== 'no',
                'tunnel' => isset($tags['tunnel']) && $tags['tunnel'] !== 'no',
                'layer' => max(-5, min(5, (int) ($tags['layer'] ?? 0))),
            ];
            $features[] = $this->feature(
                $id.'-geometry',
                'LineString',
                $roadCoordinates,
                array_filter($roadProperties, fn ($value) => $value !== null),
            );
        }

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
            $directedCoordinates = $direction === 'backward' ? array_reverse($coordinates) : $coordinates;
            $features[] = $this->feature(
                $id.'-turn-lanes-'.$direction,
                'LineString',
                $this->trimLineFromEnd($directedCoordinates, 72),
                [
                    'detailType' => 'turn_lanes',
                    'turnLanes' => $lanes,
                ],
            );
        }

        return $features;
    }

    private function trimLineFromEnd(array $coordinates, float $targetMeters): array
    {
        if (count($coordinates) < 2) {
            return $coordinates;
        }

        $trimmed = [end($coordinates)];
        $remaining = $targetMeters;

        for ($index = count($coordinates) - 2; $index >= 0; $index--) {
            $start = $coordinates[$index];
            $finish = $coordinates[$index + 1];
            $vector = $this->meterVector($finish, $start);
            $segmentLength = hypot($vector[0], $vector[1]);

            if ($segmentLength <= 0.01) {
                continue;
            }

            if ($segmentLength >= $remaining) {
                $ratio = $remaining / $segmentLength;
                array_unshift($trimmed, [
                    $finish[0] + ($start[0] - $finish[0]) * $ratio,
                    $finish[1] + ($start[1] - $finish[1]) * $ratio,
                ]);

                return $trimmed;
            }

            array_unshift($trimmed, $start);
            $remaining -= $segmentLength;
        }

        return $trimmed;
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

    private function laneCount(array $tags): ?int
    {
        $lanes = $this->positiveInteger($tags['lanes'] ?? null);

        if ($lanes === null) {
            $forward = $this->positiveInteger($tags['lanes:forward'] ?? null);
            $backward = $this->positiveInteger($tags['lanes:backward'] ?? null);
            $lanes = ($forward !== null || $backward !== null)
                ? ($forward ?? 0) + ($backward ?? 0)
                : null;
        }

        return $lanes === null ? null : max(1, min(10, $lanes));
    }

    private function directionBoundary(array $tags, int $laneCount): ?int
    {
        if ($this->isOneway($tags)) {
            return null;
        }

        $backward = $this->positiveInteger($tags['lanes:backward'] ?? null);
        if ($backward !== null && $backward < $laneCount) {
            return $backward;
        }

        $forward = $this->positiveInteger($tags['lanes:forward'] ?? null);
        if ($forward !== null && $forward < $laneCount) {
            return $laneCount - $forward;
        }

        return (int) floor($laneCount / 2);
    }

    private function positiveInteger(mixed $value): ?int
    {
        return preg_match('/^\d{1,2}$/', trim((string) $value)) === 1
            ? max(1, (int) $value)
            : null;
    }

    private function isOneway(array $tags): bool
    {
        return in_array(mb_strtolower((string) ($tags['oneway'] ?? '')), ['yes', '1', '-1', 'true'], true)
            || ($tags['highway'] ?? '') === 'motorway';
    }

    private function normalizeRoadClass(mixed $value): string
    {
        return str_replace('_link', '', mb_strtolower(trim((string) $value)));
    }

    private function roadGoreFeatures(array $elements): array
    {
        $branches = [];

        foreach ($elements as $element) {
            $tags = (array) ($element['tags'] ?? []);
            $nodes = array_values((array) ($element['nodes'] ?? []));
            $geometry = array_values((array) ($element['geometry'] ?? []));
            $laneCount = $this->laneCount($tags);

            if (($element['type'] ?? null) !== 'way'
                || $laneCount === null
                || ! $this->isMajorRoad($tags['highway'] ?? '')
                || count($nodes) < 2
                || count($nodes) !== count($geometry)) {
                continue;
            }

            foreach ([[0, 1], [count($nodes) - 1, count($nodes) - 2]] as [$nodeIndex, $nextIndex]) {
                $origin = $geometry[$nodeIndex] ?? null;
                $next = $geometry[$nextIndex] ?? null;

                if (! $this->validPoint($origin) || ! $this->validPoint($next)) {
                    continue;
                }

                $branches[(string) $nodes[$nodeIndex]][] = [
                    'wayId' => (string) ($element['id'] ?? ''),
                    'origin' => [(float) $origin['lon'], (float) $origin['lat']],
                    'next' => [(float) $next['lon'], (float) $next['lat']],
                    'halfWidth' => max(3.2, min(18, $laneCount * 1.75)),
                    'layer' => max(-5, min(5, (int) ($tags['layer'] ?? 0))),
                ];
            }
        }

        $features = [];

        foreach ($branches as $nodeId => $nodeBranches) {
            if (count($nodeBranches) < 3) {
                continue;
            }

            for ($first = 0; $first < count($nodeBranches) - 1; $first++) {
                for ($second = $first + 1; $second < count($nodeBranches); $second++) {
                    $feature = $this->roadGoreFeature($nodeId, $nodeBranches[$first], $nodeBranches[$second]);
                    if ($feature !== null) {
                        $features[] = $feature;
                    }
                }
            }
        }

        return array_slice($features, 0, 160);
    }

    private function roadGoreFeature(string $nodeId, array $first, array $second): ?array
    {
        if ($first['wayId'] === $second['wayId'] || $first['layer'] !== $second['layer']) {
            return null;
        }

        $origin = $first['origin'];
        $firstVector = $this->meterVector($origin, $first['next']);
        $secondVector = $this->meterVector($origin, $second['next']);
        $firstLength = hypot($firstVector[0], $firstVector[1]);
        $secondLength = hypot($secondVector[0], $secondVector[1]);

        if ($firstLength < 8 || $secondLength < 8) {
            return null;
        }

        $firstUnit = [$firstVector[0] / $firstLength, $firstVector[1] / $firstLength];
        $secondUnit = [$secondVector[0] / $secondLength, $secondVector[1] / $secondLength];
        $dot = max(-1, min(1, $firstUnit[0] * $secondUnit[0] + $firstUnit[1] * $secondUnit[1]));
        $angle = rad2deg(acos($dot));

        if ($angle < 12 || $angle > 72) {
            return null;
        }

        $cross = $firstUnit[0] * $secondUnit[1] - $firstUnit[1] * $secondUnit[0];
        $firstNormal = $cross > 0
            ? [-$firstUnit[1], $firstUnit[0]]
            : [$firstUnit[1], -$firstUnit[0]];
        $secondNormal = $cross > 0
            ? [$secondUnit[1], -$secondUnit[0]]
            : [-$secondUnit[1], $secondUnit[0]];
        $length = min(48, max(24, min($firstLength, $secondLength) * 0.72));
        $tipDistance = min(8, $length * 0.18);
        $bisector = [$firstUnit[0] + $secondUnit[0], $firstUnit[1] + $secondUnit[1]];
        $bisectorLength = max(0.001, hypot($bisector[0], $bisector[1]));
        $bisector = [$bisector[0] / $bisectorLength, $bisector[1] / $bisectorLength];

        $tip = $this->offsetCoordinate($origin, [
            $bisector[0] * $tipDistance,
            $bisector[1] * $tipDistance,
        ]);
        $firstEdge = $this->offsetCoordinate($origin, [
            $firstUnit[0] * $length + $firstNormal[0] * $first['halfWidth'],
            $firstUnit[1] * $length + $firstNormal[1] * $first['halfWidth'],
        ]);
        $secondEdge = $this->offsetCoordinate($origin, [
            $secondUnit[0] * $length + $secondNormal[0] * $second['halfWidth'],
            $secondUnit[1] * $length + $secondNormal[1] * $second['halfWidth'],
        ]);

        return $this->feature(
            "road-gore-{$nodeId}-{$first['wayId']}-{$second['wayId']}",
            'Polygon',
            [[$tip, $firstEdge, $secondEdge, $tip]],
            [
                'detailType' => 'road_gore',
                'layer' => $first['layer'],
            ],
        );
    }

    private function meterVector(array $origin, array $target): array
    {
        $latitudeRadians = deg2rad(($origin[1] + $target[1]) / 2);

        return [
            ($target[0] - $origin[0]) * 111320 * cos($latitudeRadians),
            ($target[1] - $origin[1]) * 110540,
        ];
    }

    private function offsetCoordinate(array $origin, array $offset): array
    {
        $latitudeRadians = deg2rad($origin[1]);

        return [
            $origin[0] + $offset[0] / max(1, 111320 * cos($latitudeRadians)),
            $origin[1] + $offset[1] / 110540,
        ];
    }

    private function validPoint(mixed $point): bool
    {
        return is_array($point)
            && is_numeric($point['lon'] ?? null)
            && is_numeric($point['lat'] ?? null);
    }

    private function isMajorRoad(mixed $value): bool
    {
        return in_array(mb_strtolower((string) $value), [
            'motorway',
            'trunk',
            'primary',
            'secondary',
            'tertiary',
            'motorway_link',
            'trunk_link',
            'primary_link',
            'secondary_link',
            'tertiary_link',
        ], true);
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
