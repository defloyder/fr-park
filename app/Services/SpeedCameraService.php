<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class SpeedCameraService
{
    private const ROUTE_DISTANCE_THRESHOLD_METERS = 55;
    private const ROUTE_BOUNDS_PADDING_DEGREES = 0.006;

    public function __construct(private readonly NavigationGeometryService $geometry)
    {
    }

    public function camerasForRoute(array $coordinates): array
    {
        if (count($coordinates) < 2) {
            return [];
        }

        return collect($this->fetchOpenStreetMapSpeedCameras($coordinates))
            ->unique(fn ($camera) => collect([
                number_format((float) $camera['latitude'], 5, '.', ''),
                number_format((float) $camera['longitude'], 5, '.', ''),
                $camera['maxspeed'] ?? '',
                $camera['cameraType'] ?? '',
            ])->join(':'))
            ->map(fn ($camera) => $this->normalizeCameraForRoute($camera, $coordinates))
            ->filter(fn ($camera) => $camera['routeDistanceMeters'] < self::ROUTE_DISTANCE_THRESHOLD_METERS)
            ->sortBy('routeOffsetMeters')
            ->values()
            ->all();
    }

    private function fetchOpenStreetMapSpeedCameras(array $coordinates): array
    {
        $bounds = $this->geometry->routeBounds($coordinates, self::ROUTE_BOUNDS_PADDING_DEGREES);
        $bbox = "({$bounds['south']},{$bounds['west']},{$bounds['north']},{$bounds['east']})";
        $query = <<<OVERPASS
            [out:json][timeout:18];
            (
              node["highway"="speed_camera"]{$bbox};
              way["highway"="speed_camera"]{$bbox};
              relation["highway"="speed_camera"]{$bbox};
              node["enforcement"~"maxspeed|speed|average_speed|traffic_signals|bus_lane"]{$bbox};
              way["enforcement"~"maxspeed|speed|average_speed|traffic_signals|bus_lane"]{$bbox};
              relation["enforcement"~"maxspeed|speed|average_speed|traffic_signals|bus_lane"]{$bbox};
              node["camera:type"~"speed|redlight|traffic|bus_lane"]{$bbox};
              way["camera:type"~"speed|redlight|traffic|bus_lane"]{$bbox};
              relation["camera:type"~"speed|redlight|traffic|bus_lane"]{$bbox};
            );
            out center 240;
            OVERPASS;
        $fallbackQuery = <<<OVERPASS
            [out:json][timeout:12];
            (
              node["highway"="speed_camera"]{$bbox};
              node["enforcement"~"maxspeed|speed|average_speed|traffic_signals|bus_lane"]{$bbox};
              node["camera:type"~"speed|redlight|traffic|bus_lane"]{$bbox};
            );
            out center 180;
            OVERPASS;

        try {
            return $this->parseSpeedCameraPayload($this->fetchOverpassPayload($query));
        } catch (\Throwable) {
            return $this->parseSpeedCameraPayload($this->fetchOverpassPayload($fallbackQuery));
        }
    }

    private function fetchOverpassPayload(string $query): array
    {
        return Cache::remember('speed-cameras:overpass:'.sha1($query), now()->addMinutes(20), function () use ($query) {
            return Http::timeout(20)
                ->asForm()
                ->post('https://overpass-api.de/api/interpreter', ['data' => $query])
                ->throw()
                ->json();
        });
    }

    private function parseSpeedCameraPayload(array $payload): array
    {
        return collect((array) data_get($payload, 'elements', []))
            ->map(function ($item): ?array {
                $tags = (array) data_get($item, 'tags', []);
                $latitude = data_get($item, 'lat') ?? data_get($item, 'center.lat');
                $longitude = data_get($item, 'lon') ?? data_get($item, 'center.lon');

                if (! is_numeric($latitude) || ! is_numeric($longitude)) {
                    return null;
                }

                return [
                    'id' => data_get($item, 'id'),
                    'osmType' => data_get($item, 'type'),
                    'latitude' => (float) $latitude,
                    'longitude' => (float) $longitude,
                    'title' => $tags['name'] ?? 'Камера контроля скорости',
                    'maxspeed' => $tags['maxspeed'] ?? $tags['maxspeed:forward'] ?? $tags['maxspeed:backward'] ?? '',
                    'direction' => $tags['direction'] ?? $tags['camera:direction'] ?? $tags['surveillance:direction'] ?? '',
                    'cameraType' => $tags['camera:type'] ?? $tags['enforcement'] ?? '',
                    'isDummy' => $this->isDummyCamera($tags),
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    private function normalizeCameraForRoute(array $camera, array $coordinates): array
    {
        $routePoint = $this->geometry->closestRoutePoint($coordinates, $camera);
        $bearing = $this->resolveCameraBearing((string) $camera['direction'], (float) $routePoint['bearing']);
        $directionLabel = $this->cameraDirectionLabel($bearing, (float) $routePoint['bearing']);
        $maxspeed = (string) ($camera['maxspeed'] ?? '');
        $labelParts = array_filter([
            $camera['isDummy'] ? 'Муляж' : 'Камера',
            $maxspeed !== '' ? (string) ((int) $maxspeed ?: $maxspeed) : '',
            $directionLabel['short'],
        ]);

        return [
            ...$camera,
            'originalLatitude' => $camera['latitude'],
            'originalLongitude' => $camera['longitude'],
            'latitude' => $routePoint['latitude'],
            'longitude' => $routePoint['longitude'],
            'bearing' => $bearing,
            'routeOffsetMeters' => $routePoint['progressMeters'],
            'routeDistanceMeters' => $routePoint['distanceMeters'],
            'directionLabel' => $directionLabel,
            'label' => implode(' · ', $labelParts),
        ];
    }

    private function isDummyCamera(array $tags): bool
    {
        $text = collect($tags)->map(fn ($value, $key) => "{$key}={$value}")->join(' ');

        return preg_match('/\bdummy\b|муляж|fake|decoy|имитац/ui', mb_strtolower($text)) === 1;
    }

    private function resolveCameraBearing(string $direction, float $routeBearing): float
    {
        $normalized = mb_strtolower(trim($direction));

        if (is_numeric($normalized)) {
            return fmod((float) $normalized + 360, 360);
        }

        if (in_array($normalized, ['forward', 'forwards', 'по ходу'], true)) {
            return $routeBearing;
        }

        if (in_array($normalized, ['backward', 'backwards', 'against', 'против'], true)) {
            return fmod($routeBearing + 180, 360);
        }

        $cardinal = [
            'n' => 0, 'north' => 0,
            'ne' => 45, 'northeast' => 45,
            'e' => 90, 'east' => 90,
            'se' => 135, 'southeast' => 135,
            's' => 180, 'south' => 180,
            'sw' => 225, 'southwest' => 225,
            'w' => 270, 'west' => 270,
            'nw' => 315, 'northwest' => 315,
        ];

        return (float) ($cardinal[$normalized] ?? $routeBearing);
    }

    private function cameraDirectionLabel(float $cameraBearing, float $routeBearing): array
    {
        $diff = $this->geometry->angleDifference($cameraBearing, $routeBearing);

        if ($diff <= 45) {
            return ['short' => 'в спину', 'text' => 'в спину'];
        }

        if ($diff >= 135) {
            return ['short' => 'навстречу', 'text' => 'навстречу'];
        }

        return $cameraBearing > $routeBearing
            ? ['short' => 'справа', 'text' => 'справа']
            : ['short' => 'слева', 'text' => 'слева'];
    }
}
