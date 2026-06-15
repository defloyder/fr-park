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
            [out:json][timeout:8];
            (
              way["highway"="motorway"]{$bbox};
              way["highway"="trunk"]{$bbox};
              way["highway"="primary"]{$bbox};
              way["highway"="secondary"]{$bbox};
              way["highway"="tertiary"]{$bbox};
              way["highway"="motorway_link"]{$bbox};
              way["highway"="trunk_link"]{$bbox};
              way["highway"="primary_link"]{$bbox};
              way["highway"="secondary_link"]{$bbox};
              way["highway"="tertiary_link"]{$bbox};
            )->.roads;
            (.roads; >;);
            out body qt;
            OVERPASS;

        $cacheKey = 'road-details:features:v7:'.sha1(json_encode($this->quantizeBounds($bounds)));

        return Cache::remember(
            $cacheKey,
            now()->addMinutes(45),
            function () use ($query) {
                $payload = $this->fetchOverpass($query);

                return array_slice(
                    $this->prioritizeFeatures(
                        $this->toGeoJsonFeatures((array) data_get($payload, 'elements', [])),
                    ),
                    0,
                    1200,
                );
            },
        );
    }

    private function quantizeBounds(array $bounds): array
    {
        $precision = 4;

        return [
            'south' => round($bounds['south'], $precision),
            'west' => round($bounds['west'], $precision),
            'north' => round($bounds['north'], $precision),
            'east' => round($bounds['east'], $precision),
        ];
    }

    private function fetchOverpass(string $query): array
    {
        $lastException = null;

        foreach ([
            'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
            'https://z.overpass-api.de/api/interpreter',
            'https://overpass-api.de/api/interpreter',
        ] as $endpoint) {
            try {
                $request = Http::withHeaders([
                    'Accept' => 'application/json',
                    'User-Agent' => 'Auralith-Maps/1.0',
                ])
                    ->connectTimeout(2)
                    ->timeout(6);

                if (app()->environment('local')) {
                    $request = $request->withoutVerifying();
                }

                return $request
                    ->asForm()
                    ->post($endpoint, ['data' => $query])
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
        $elements = $this->hydrateWayGeometry($elements);
        $nodeBearings = $this->nodeBearings($elements);

        $features = collect($elements)
            ->flatMap(fn (array $element) => $this->elementFeatures($element, $nodeBearings))
            ->values()
            ->all();

        return array_merge(
            $features,
            $this->roadGoreFeatures($elements),
            $this->forkGuidanceFeatures($elements),
        );
    }

    private function hydrateWayGeometry(array $elements): array
    {
        $nodeCoordinates = [];

        foreach ($elements as $element) {
            if (($element['type'] ?? null) !== 'node'
                || ! is_numeric($element['lon'] ?? null)
                || ! is_numeric($element['lat'] ?? null)) {
                continue;
            }

            $nodeCoordinates[(string) ($element['id'] ?? '')] = [
                'lon' => (float) $element['lon'],
                'lat' => (float) $element['lat'],
            ];
        }

        return array_map(function (array $element) use ($nodeCoordinates) {
            if (($element['type'] ?? null) !== 'way' || ! empty($element['geometry'])) {
                return $element;
            }

            $element['geometry'] = collect((array) ($element['nodes'] ?? []))
                ->map(fn ($nodeId) => $nodeCoordinates[(string) $nodeId] ?? null)
                ->filter()
                ->values()
                ->all();

            return $element;
        }, $elements);
    }

    private function prioritizeFeatures(array $features): array
    {
        $priority = [
            'road_geometry' => 0,
            'road_gore' => 1,
            'turn_lanes' => 2,
            'crossing' => 3,
            'traffic_signal' => 4,
            'speed_bump' => 5,
            'maxspeed' => 6,
            'parking_restriction' => 7,
        ];

        usort($features, fn (array $left, array $right) => (
            ($priority[data_get($left, 'properties.detailType')] ?? 99)
            <=>
            ($priority[data_get($right, 'properties.detailType')] ?? 99)
        ));

        return $features;
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
            $roadProperties = [
                'detailType' => 'road_geometry',
                'roadClass' => $this->normalizeRoadClass($tags['highway'] ?? ''),
                'laneCount' => $laneCount,
                'oneway' => $this->isOneway($tags),
                'isLink' => str_ends_with(mb_strtolower((string) ($tags['highway'] ?? '')), '_link') ? 1 : 0,
                'directionBoundary' => $directionBoundary,
                'name' => trim((string) ($tags['name'] ?? '')),
                'ref' => trim((string) ($tags['ref'] ?? '')),
                'bridge' => isset($tags['bridge']) && $tags['bridge'] !== 'no',
                'tunnel' => isset($tags['tunnel']) && $tags['tunnel'] !== 'no',
                'layer' => max(-5, min(5, (int) ($tags['layer'] ?? 0))),
            ];
            $roadCoordinates = (string) ($tags['oneway'] ?? '') === '-1'
                ? array_reverse($coordinates)
                : $coordinates;

            if (($roadProperties['isLink'] ?? 0) === 1) {
                $roadCoordinates = $this->extendLineEnds($roadCoordinates, 16);
            } else {
                $roadCoordinates = $this->extendLineEnds($roadCoordinates, 9);
            }

            $features[] = $this->feature(
                $id.'-geometry',
                'LineString',
                $roadCoordinates,
                array_filter($roadProperties, fn ($value) => $value !== null),
            );
        }

        if ($maxspeed !== '') {
            $labelPoint = $this->pointAlongLine($coordinates, 0.5);

            if ($labelPoint !== null) {
                $features[] = $this->feature($id.'-speed', 'Point', $labelPoint, [
                    'detailType' => 'maxspeed',
                    'maxspeed' => $maxspeed,
                    'bearing' => $this->lineBearingAt($coordinates, 0.5),
                ]);
            }
        }

        foreach ($this->turnLaneFeatures($id, $coordinates, $tags) as $feature) {
            $features[] = $feature;
        }

        $roadClass = $this->normalizeRoadClass($tags['highway'] ?? '');

        if (! in_array($roadClass, ['motorway', 'trunk'], true)) {
            foreach (['left', 'right'] as $side) {
                if ($this->hasParkingRestriction($tags, $side)) {
                    $features = array_merge($features, $this->parkingRestrictionFeatures(
                        $id.'-parking-'.$side,
                        $coordinates,
                        $side,
                    ));
                }
            }

            if ($this->hasParkingRestriction($tags, 'both')) {
                foreach (['left', 'right'] as $side) {
                    $features = array_merge($features, $this->parkingRestrictionFeatures(
                        $id.'-parking-both-'.$side,
                        $coordinates,
                        $side,
                    ));
                }
            }
        }

        return $features;
    }

    private function turnLaneFeatures(string $id, array $coordinates, array $tags): array
    {
        if (str_ends_with(mb_strtolower((string) ($tags['highway'] ?? '')), '_link')) {
            return [];
        }

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
            $approach = $this->trimLineFromEnd($directedCoordinates, 90);

            if (count($approach) < 2) {
                continue;
            }

            $point = $this->pointAlongLine($approach, 0.76);

            if ($point === null) {
                continue;
            }

            $travelBearing = $this->lineBearingAt($approach, 0.76);
            $features[] = $this->feature(
                $id.'-turn-lanes-'.$direction,
                'Point',
                $point,
                [
                    'detailType' => 'turn_lanes',
                    'turnLanes' => $lanes,
                    'bearing' => fmod($travelBearing - 90 + 360, 360),
                ],
            );
        }

        return $features;
    }

    private function parkingRestrictionFeatures(string $id, array $coordinates, string $side): array
    {
        $length = $this->lineLength($coordinates);
        $ratios = match (true) {
            $length > 420 => [0.24, 0.5, 0.76],
            $length > 180 => [0.34, 0.68],
            default => [0.5],
        };
        $features = [];

        foreach ($ratios as $index => $ratio) {
            $point = $this->pointAlongLine($coordinates, $ratio);

            if ($point === null) {
                continue;
            }

            $bearing = $this->lineBearingAt($coordinates, $ratio);
            $radians = deg2rad($bearing);
            $normal = $side === 'left'
                ? [-cos($radians), sin($radians)]
                : [cos($radians), -sin($radians)];
            $point = $this->offsetCoordinate($point, [
                $normal[0] * 5.2,
                $normal[1] * 5.2,
            ]);

            $features[] = $this->feature($id.'-'.$index, 'Point', $point, [
                'detailType' => 'parking_restriction',
                'side' => $side,
            ]);
        }

        return $features;
    }

    private function pointAlongLine(array $coordinates, float $targetRatio): ?array
    {
        if (count($coordinates) < 2) {
            return null;
        }

        $targetRatio = max(0, min(1, $targetRatio));
        $segmentLengths = [];
        $totalLength = 0.0;

        for ($index = 0; $index < count($coordinates) - 1; $index++) {
            $vector = $this->meterVector($coordinates[$index], $coordinates[$index + 1]);
            $length = hypot($vector[0], $vector[1]);
            $segmentLengths[] = $length;
            $totalLength += $length;
        }

        if ($totalLength <= 0.01) {
            return $coordinates[0];
        }

        $targetDistance = $totalLength * $targetRatio;
        $remaining = $targetDistance;

        for ($index = 0; $index < count($segmentLengths); $index++) {
            $segmentLength = $segmentLengths[$index];

            if ($segmentLength <= 0.01) {
                continue;
            }

            if ($remaining <= $segmentLength) {
                $ratio = $remaining / $segmentLength;
                $start = $coordinates[$index];
                $finish = $coordinates[$index + 1];

                return [
                    $start[0] + ($finish[0] - $start[0]) * $ratio,
                    $start[1] + ($finish[1] - $start[1]) * $ratio,
                ];
            }

            $remaining -= $segmentLength;
        }

        return $coordinates[count($coordinates) - 1];
    }

    private function lineBearingAt(array $coordinates, float $targetRatio): float
    {
        if (count($coordinates) < 2) {
            return 0;
        }

        $point = $this->pointAlongLine($coordinates, $targetRatio);

        if ($point === null) {
            return 0;
        }

        $targetDistance = 0.0;
        $totalLength = 0.0;
        $segmentLengths = [];

        for ($index = 0; $index < count($coordinates) - 1; $index++) {
            $vector = $this->meterVector($coordinates[$index], $coordinates[$index + 1]);
            $length = hypot($vector[0], $vector[1]);
            $segmentLengths[] = $length;
            $totalLength += $length;
        }

        $sample = max(0.01, min($totalLength - 0.01, $totalLength * $targetRatio));
        $remaining = $sample;

        for ($index = 0; $index < count($segmentLengths); $index++) {
            if ($remaining <= $segmentLengths[$index]) {
                $start = $coordinates[$index];
                $finish = $coordinates[$index + 1];

                return $this->bearing($start[1], $start[0], $finish[1], $finish[0]);
            }

            $remaining -= $segmentLengths[$index];
        }

        $start = $coordinates[count($coordinates) - 2];
        $finish = $coordinates[count($coordinates) - 1];

        return $this->bearing($start[1], $start[0], $finish[1], $finish[0]);
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

    private function lineLength(array $coordinates): float
    {
        $length = 0.0;

        for ($index = 0; $index < count($coordinates) - 1; $index++) {
            $vector = $this->meterVector($coordinates[$index], $coordinates[$index + 1]);
            $length += hypot($vector[0], $vector[1]);
        }

        return $length;
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

        if ($lanes === null && $this->isMajorRoad($tags['highway'] ?? '')) {
            $highway = mb_strtolower((string) ($tags['highway'] ?? ''));
            $lanes = match (true) {
                $highway === 'motorway' => 4,
                $highway === 'trunk' => 3,
                $highway === 'primary' => 3,
                $highway === 'secondary' => 2,
                $highway === 'tertiary' => 2,
                str_ends_with($highway, '_link') => 2,
                default => null,
            };
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

    private function forkGuidanceFeatures(array $elements): array
    {
        $ways = [];
        $nodeWays = [];

        foreach ($elements as $element) {
            $tags = (array) ($element['tags'] ?? []);
            $nodes = array_values((array) ($element['nodes'] ?? []));
            $geometry = array_values((array) ($element['geometry'] ?? []));
            $laneCount = $this->laneCount($tags);

            if (($element['type'] ?? null) !== 'way'
                || $laneCount === null
                || count($nodes) < 3
                || count($nodes) !== count($geometry)
                || ! $this->isMajorRoad($tags['highway'] ?? '')) {
                continue;
            }

            $coordinates = collect($geometry)
                ->filter(fn ($point) => $this->validPoint($point))
                ->map(fn ($point) => [(float) $point['lon'], (float) $point['lat']])
                ->values()
                ->all();

            if (count($coordinates) !== count($nodes)) {
                continue;
            }

            $wayIndex = count($ways);
            $ways[] = [
                'id' => (string) ($element['id'] ?? $wayIndex),
                'nodes' => $nodes,
                'coordinates' => $coordinates,
                'tags' => $tags,
                'laneCount' => $laneCount,
                'isLink' => str_ends_with(mb_strtolower((string) ($tags['highway'] ?? '')), '_link'),
                'layer' => max(-5, min(5, (int) ($tags['layer'] ?? 0))),
            ];

            foreach ($nodes as $nodeIndex => $nodeId) {
                $nodeWays[(string) $nodeId][] = [$wayIndex, $nodeIndex];
            }
        }

        $features = [];

        foreach ($ways as $link) {
            if (! $link['isLink']) {
                continue;
            }

            $reverse = (string) ($link['tags']['oneway'] ?? '') === '-1';
            $departureIndex = $reverse ? count($link['nodes']) - 1 : 0;
            $nextIndex = $reverse ? $departureIndex - 1 : 1;
            $nodeId = (string) $link['nodes'][$departureIndex];
            $origin = $link['coordinates'][$departureIndex];
            $linkVector = $this->meterVector($origin, $link['coordinates'][$nextIndex]);
            $best = null;

            foreach ($nodeWays[$nodeId] ?? [] as [$candidateIndex, $candidateNodeIndex]) {
                $main = $ways[$candidateIndex] ?? null;

                if ($main === null
                    || $main['id'] === $link['id']
                    || $main['isLink']
                    || $main['layer'] !== $link['layer']
                    || isset($main['tags']['turn:lanes'])
                    || isset($main['tags']['turn:lanes:forward'])
                    || isset($main['tags']['turn:lanes:backward'])) {
                    continue;
                }

                $mainReverse = (string) ($main['tags']['oneway'] ?? '') === '-1';
                $incomingIndex = $mainReverse ? $candidateNodeIndex + 1 : $candidateNodeIndex - 1;
                $outgoingIndex = $mainReverse ? $candidateNodeIndex - 1 : $candidateNodeIndex + 1;

                if (! isset($main['coordinates'][$incomingIndex], $main['coordinates'][$outgoingIndex])) {
                    continue;
                }

                $mainVector = $this->meterVector($origin, $main['coordinates'][$outgoingIndex]);
                $mainLength = hypot($mainVector[0], $mainVector[1]);
                $linkLength = hypot($linkVector[0], $linkVector[1]);

                if ($mainLength < 5 || $linkLength < 5) {
                    continue;
                }

                $dot = max(-1, min(1, (
                    $mainVector[0] * $linkVector[0] + $mainVector[1] * $linkVector[1]
                ) / ($mainLength * $linkLength)));
                $angle = rad2deg(acos($dot));

                if ($angle < 8 || $angle > 78 || ($best !== null && $angle >= $best['angle'])) {
                    continue;
                }

                $best = [
                    'angle' => $angle,
                    'main' => $main,
                    'nodeIndex' => $candidateNodeIndex,
                    'mainReverse' => $mainReverse,
                    'cross' => $mainVector[0] * $linkVector[1] - $mainVector[1] * $linkVector[0],
                ];
            }

            if ($best === null) {
                continue;
            }

            $approach = $best['mainReverse']
                ? array_reverse(array_slice($best['main']['coordinates'], $best['nodeIndex']))
                : array_slice($best['main']['coordinates'], 0, $best['nodeIndex'] + 1);
            $approach = $this->trimLineFromEnd($approach, 110);
            $point = $this->pointAlongLine($approach, 0.68);

            if ($point === null || count($approach) < 2) {
                continue;
            }

            $laneCount = max(1, min(6, $best['main']['laneCount']));
            $turn = $best['cross'] >= 0 ? 'slight_left' : 'slight_right';
            $lanes = array_fill(0, $laneCount, ['through']);
            $turnLaneIndex = $turn === 'slight_left' ? 0 : $laneCount - 1;
            $lanes[$turnLaneIndex] = ['through', $turn];

            $features[] = $this->feature(
                "road-fork-guidance-{$best['main']['id']}-{$link['id']}",
                'Point',
                $point,
                [
                    'detailType' => 'turn_lanes',
                    'turnLanes' => $lanes,
                    'bearing' => fmod($this->lineBearingAt($approach, 0.68) - 90 + 360, 360),
                    'inferred' => true,
                ],
            );
        }

        return array_slice($features, 0, 120);
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
                    'isLink' => str_ends_with(mb_strtolower((string) ($tags['highway'] ?? '')), '_link'),
                ];
            }
        }

        $features = [];

        foreach ($branches as $nodeId => $nodeBranches) {
            if (count($nodeBranches) === 2) {
                $feature = $this->roadGoreFeature($nodeId, $nodeBranches[0], $nodeBranches[1]);
                if ($feature !== null) {
                    $features[] = $feature;
                }

                continue;
            }

            if (count($nodeBranches) < 3) {
                continue;
            }

            foreach ($nodeBranches as $index => $branch) {
                if (! $branch['isLink']) {
                    continue;
                }

                $bestMatch = null;
                $bestAngle = null;

                foreach ($nodeBranches as $otherIndex => $other) {
                    if ($index === $otherIndex || $other['isLink']) {
                        continue;
                    }

                    $angle = $this->branchForkAngle($branch, $other);

                    if ($angle === null || $angle < 18 || $angle > 72) {
                        continue;
                    }

                    if ($bestAngle === null || $angle < $bestAngle) {
                        $bestAngle = $angle;
                        $bestMatch = $other;
                    }
                }

                if ($bestMatch === null) {
                    continue;
                }

                $feature = $this->roadGoreFeature($nodeId, $branch, $bestMatch);
                if ($feature !== null) {
                    $features[] = $feature;
                }
            }
        }

        return array_slice($features, 0, 80);
    }

    private function branchForkAngle(array $first, array $second): ?float
    {
        if ($first['wayId'] === $second['wayId']) {
            return null;
        }

        $firstVector = $this->meterVector($first['origin'], $first['next']);
        $secondVector = $this->meterVector($second['origin'], $second['next']);
        $firstLength = hypot($firstVector[0], $firstVector[1]);
        $secondLength = hypot($secondVector[0], $secondVector[1]);

        if ($firstLength < 6 || $secondLength < 6) {
            return null;
        }

        $firstUnit = [$firstVector[0] / $firstLength, $firstVector[1] / $firstLength];
        $secondUnit = [$secondVector[0] / $secondLength, $secondVector[1] / $secondLength];
        $dot = max(-1, min(1, $firstUnit[0] * $secondUnit[0] + $firstUnit[1] * $secondUnit[1]));

        return rad2deg(acos($dot));
    }

    private function shouldCreateRoadGore(array $first, array $second): bool
    {
        if ($first['wayId'] === $second['wayId'] || $first['layer'] !== $second['layer']) {
            return false;
        }

        if (! $first['isLink'] && ! $second['isLink']) {
            return false;
        }

        $angle = $this->branchForkAngle($first, $second);

        return $angle !== null && $angle >= 18 && $angle <= 72;
    }

    private function roadGoreFeature(string $nodeId, array $first, array $second): ?array
    {
        if (! $this->shouldCreateRoadGore($first, $second)) {
            return null;
        }

        $origin = $first['origin'];
        $firstVector = $this->meterVector($origin, $first['next']);
        $secondVector = $this->meterVector($origin, $second['next']);
        $firstLength = hypot($firstVector[0], $firstVector[1]);
        $secondLength = hypot($secondVector[0], $secondVector[1]);

        if ($firstLength < 6 || $secondLength < 6) {
            return null;
        }

        $firstUnit = [$firstVector[0] / $firstLength, $firstVector[1] / $firstLength];
        $secondUnit = [$secondVector[0] / $secondLength, $secondVector[1] / $secondLength];
        $dot = max(-1, min(1, $firstUnit[0] * $secondUnit[0] + $firstUnit[1] * $secondUnit[1]));
        $angle = rad2deg(acos($dot));

        if ($angle < 18 || $angle > 72) {
            return null;
        }

        $cross = $firstUnit[0] * $secondUnit[1] - $firstUnit[1] * $secondUnit[0];
        $firstNormal = $cross > 0
            ? [-$firstUnit[1], $firstUnit[0]]
            : [$firstUnit[1], -$firstUnit[0]];
        $secondNormal = $cross > 0
            ? [$secondUnit[1], -$secondUnit[0]]
            : [-$secondUnit[1], $secondUnit[0]];
        $length = min(64, max(30, min($firstLength, $secondLength) * 0.78));
        $tipDistance = min(12, $length * 0.12);
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

    private function extendLineEnds(array $coordinates, float $meters): array
    {
        if (count($coordinates) < 2 || $meters <= 0) {
            return $coordinates;
        }

        $start = $coordinates[0];
        $second = $coordinates[1];
        $beforeLast = $coordinates[count($coordinates) - 2];
        $finish = $coordinates[count($coordinates) - 1];
        $startVector = $this->meterVector($second, $start);
        $finishVector = $this->meterVector($beforeLast, $finish);
        $startLength = max(0.001, hypot($startVector[0], $startVector[1]));
        $finishLength = max(0.001, hypot($finishVector[0], $finishVector[1]));
        $startUnit = [$startVector[0] / $startLength, $startVector[1] / $startLength];
        $finishUnit = [$finishVector[0] / $finishLength, $finishVector[1] / $finishLength];

        $extended = $coordinates;
        $extended[0] = $this->offsetCoordinate($start, [
            $startUnit[0] * $meters,
            $startUnit[1] * $meters,
        ]);
        $extended[count($extended) - 1] = $this->offsetCoordinate($finish, [
            $finishUnit[0] * $meters,
            $finishUnit[1] * $meters,
        ]);

        return $extended;
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
