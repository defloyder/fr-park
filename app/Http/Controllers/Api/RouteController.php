<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class RouteController extends Controller
{
    public function driving(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from_latitude' => ['required', 'numeric', 'between:-90,90'],
            'from_longitude' => ['required', 'numeric', 'between:-180,180'],
            'to_latitude' => ['required', 'numeric', 'between:-90,90'],
            'to_longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $tomTomApiKey = config('services.tomtom_traffic.key');

        if (is_string($tomTomApiKey) && trim($tomTomApiKey) !== '') {
            try {
                return response()->json($this->buildTomTomRoute($validated, trim($tomTomApiKey)));
            } catch (Throwable $exception) {
                Log::warning('TomTom Routing API request failed', [
                    'message' => $exception->getMessage(),
                ]);
            }
        }

        $apiKey = config('services.yandex_router.key');
        $isYandexEnabled = (bool) config('services.yandex_router.enabled');

        if (! $isYandexEnabled || ! is_string($apiKey) || trim($apiKey) === '') {
            return response()->json([
                'message' => 'Traffic routing API key is not configured.',
                'source' => 'yandex-unavailable',
            ]);
        }

        try {
            $response = Http::timeout(14)
                ->acceptJson()
                ->get('https://api.routing.yandex.net/v2/route', [
                    'apikey' => $apiKey,
                    'waypoints' => implode('|', [
                        $validated['from_latitude'].','.$validated['from_longitude'],
                        $validated['to_latitude'].','.$validated['to_longitude'],
                    ]),
                    'mode' => 'driving',
                ])
                ->throw()
                ->json();

            $route = data_get($response, 'route') ?: data_get($response, 'routes.0');
            Log::debug('Yandex Router API response received', [
                'has_route' => is_array($route),
                'keys' => array_keys(is_array($response) ? $response : []),
            ]);

            if (! is_array($route)) {
                return response()->json([
                    'message' => 'Yandex Router API returned an empty route.',
                    'source' => 'yandex-unavailable',
                ]);
            }

            return response()->json($this->normalizeRoute($route));
        } catch (Throwable $exception) {
            Log::warning('Yandex Router API request failed', [
                'message' => $exception->getMessage(),
            ]);

            return response()->json([
                'message' => 'Failed to build Yandex traffic route.',
                'detail' => app()->hasDebugModeEnabled() ? $exception->getMessage() : null,
                'source' => 'yandex-unavailable',
            ]);
        }
    }

    private function buildTomTomRoute(array $validated, string $apiKey): array
    {
        $locations = implode(':', [
            $validated['from_latitude'].','.$validated['from_longitude'],
            $validated['to_latitude'].','.$validated['to_longitude'],
        ]);
        $url = "https://api.tomtom.com/routing/1/calculateRoute/{$locations}/json?".http_build_query([
            'key' => $apiKey,
            'travelMode' => 'car',
            'traffic' => 'true',
            'routeType' => 'fastest',
            'routeRepresentation' => 'polyline',
            'computeTravelTimeFor' => 'all',
            'instructionsType' => 'text',
            'language' => 'ru-RU',
        ]).'&sectionType=traffic&sectionType=speedLimit';

        $payload = Http::timeout(14)
            ->acceptJson()
            ->get($url)
            ->throw()
            ->json();

        $route = data_get($payload, 'routes.0');

        if (! is_array($route)) {
            throw new \RuntimeException('TomTom Routing API returned an empty route.');
        }

        return $this->normalizeTomTomRoute($route);
    }

    private function normalizeTomTomRoute(array $route): array
    {
        $coordinates = collect((array) data_get($route, 'legs', []))
            ->flatMap(fn ($leg) => (array) data_get($leg, 'points', []))
            ->map(fn ($point) => [(float) data_get($point, 'longitude'), (float) data_get($point, 'latitude')])
            ->filter(fn ($point) => $point[0] !== 0.0 && $point[1] !== 0.0)
            ->values()
            ->all();
        $summary = (array) data_get($route, 'summary', []);
        $trafficDelay = (float) data_get($summary, 'trafficDelayInSeconds', 0);
        $distanceMeters = (float) data_get($summary, 'lengthInMeters', 0);
        $durationSeconds = (float) data_get($summary, 'travelTimeInSeconds', 0);

        return [
            'geometry' => [
                'type' => 'LineString',
                'coordinates' => $coordinates,
            ],
            'segments' => $this->buildTomTomTrafficSegments($coordinates, (array) data_get($route, 'sections', []), $trafficDelay, $durationSeconds),
            'instructions' => $this->normalizeTomTomInstructions((array) data_get($route, 'guidance.instructions', [])),
            'speedLimits' => $this->normalizeTomTomSpeedLimits((array) data_get($route, 'sections', [])),
            'distanceMeters' => $distanceMeters,
            'durationSeconds' => $durationSeconds,
            'trafficDelaySeconds' => $trafficDelay,
            'source' => 'tomtom-traffic',
        ];
    }

    private function normalizeTomTomInstructions(array $instructions): array
    {
        return collect($instructions)
            ->map(function ($instruction): ?array {
                $text = data_get($instruction, 'message') ?: data_get($instruction, 'street');

                if (! is_string($text) || trim($text) === '') {
                    return null;
                }

                return [
                    'text' => trim($text),
                    'roadName' => (string) data_get($instruction, 'street', ''),
                    'distanceMeters' => 0,
                    'distanceFromStartMeters' => (float) data_get($instruction, 'routeOffsetInMeters', 0),
                    'maneuver' => (string) data_get($instruction, 'instructionType', ''),
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    private function normalizeTomTomSpeedLimits(array $sections): array
    {
        return collect($sections)
            ->filter(fn ($section) => strtoupper((string) data_get($section, 'sectionType')) === 'SPEED_LIMIT')
            ->map(function ($section): ?array {
                $limit = (int) data_get($section, 'maxSpeedLimitInKmh', 0);

                if ($limit <= 0) {
                    return null;
                }

                return [
                    'startPointIndex' => (int) data_get($section, 'startPointIndex', 0),
                    'endPointIndex' => (int) data_get($section, 'endPointIndex', 0),
                    'speedLimitKmh' => $limit,
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    private function buildTomTomTrafficSegments(array $coordinates, array $sections, float $trafficDelay, float $durationSeconds): array
    {
        if (count($coordinates) < 2) {
            return [];
        }

        $trafficSections = collect($sections)
            ->filter(fn ($section) => strtoupper((string) data_get($section, 'sectionType')) === 'TRAFFIC')
            ->values();
        $boundaries = collect([0, count($coordinates) - 1]);

        foreach ($trafficSections as $section) {
            $start = max(0, min(count($coordinates) - 1, (int) data_get($section, 'startPointIndex', 0)));
            $end = max($start, min(count($coordinates) - 1, (int) data_get($section, 'endPointIndex', $start)));
            $boundaries->push($start, $end);
        }

        $points = $boundaries->unique()->sort()->values()->all();
        $segments = [];

        for ($index = 0; $index < count($points) - 1; $index++) {
            $start = $points[$index];
            $end = $points[$index + 1];

            if ($end <= $start) {
                continue;
            }

            $section = $trafficSections->first(fn ($item) => (
                (int) data_get($item, 'startPointIndex', 0) <= $start
                && (int) data_get($item, 'endPointIndex', 0) >= $end
            ));

            $segments[] = [
                'traffic' => is_array($section)
                    ? $this->tomTomSectionTrafficLevel($section)
                    : ($trafficSections->isEmpty() ? $this->tomTomTrafficLevel($trafficDelay, $durationSeconds) : 'free'),
                'coordinates' => array_slice($coordinates, $start, $end - $start + 1),
            ];
        }

        return $segments ?: [[
            'traffic' => $this->tomTomTrafficLevel($trafficDelay, $durationSeconds),
            'coordinates' => $coordinates,
        ]];
    }

    private function tomTomSectionTrafficLevel(array $section): string
    {
        $category = strtoupper((string) data_get($section, 'simpleCategory', ''));

        if ($category === 'JAM') {
            return 'jam';
        }

        if ($category === 'ROAD_CLOSED') {
            return 'jam';
        }

        $magnitude = (int) data_get($section, 'magnitudeOfDelay', 0);
        $delay = (float) data_get($section, 'delayInSeconds', 0);

        return match (true) {
            $magnitude >= 4 || $delay >= 300 => 'jam',
            $magnitude >= 3 || $delay >= 120 => 'heavy',
            $magnitude >= 1 || $delay > 0 => 'slow',
            default => 'free',
        };
    }

    private function tomTomTrafficLevel(float $trafficDelaySeconds, float $durationSeconds): string
    {
        if ($trafficDelaySeconds <= 0 || $durationSeconds <= 0) {
            return 'free';
        }

        $delayRatio = $trafficDelaySeconds / $durationSeconds;

        return match (true) {
            $delayRatio > 0.35 => 'jam',
            $delayRatio > 0.18 => 'heavy',
            $delayRatio > 0.08 => 'slow',
            default => 'free',
        };
    }

    private function normalizeRoute(array $route): array
    {
        $segments = [];
        $coordinates = [];
        $instructions = [];
        $distanceMeters = 0.0;
        $durationSeconds = 0.0;

        foreach ((array) data_get($route, 'legs.0.steps', []) as $step) {
            $points = $this->extractStepCoordinates((array) $step);

            if (count($points) < 2) {
                continue;
            }

            $length = (float) data_get($step, 'length.value', 0);
            $duration = (float) data_get($step, 'duration.value', 0);
            $traffic = $this->trafficLevel($length, $duration);
            $instruction = $this->extractInstruction((array) $step, $length, $distanceMeters);

            $segments[] = [
                'traffic' => $traffic,
                'coordinates' => $points,
            ];

            if ($instruction !== null) {
                $instructions[] = $instruction;
            }

            array_push($coordinates, ...$points);
            $distanceMeters += $length;
            $durationSeconds += $duration;
        }

        return [
            'geometry' => [
                'type' => 'LineString',
                'coordinates' => $coordinates,
            ],
            'segments' => $segments,
            'instructions' => $instructions,
            'distanceMeters' => $distanceMeters,
            'durationSeconds' => $durationSeconds,
            'source' => 'yandex-traffic',
            'trafficType' => data_get($route, 'traffic_type'),
        ];
    }

    private function extractInstruction(array $step, float $length, float $distanceFromStart): ?array
    {
        $text = collect([
            data_get($step, 'maneuver.instruction'),
            data_get($step, 'instruction'),
            data_get($step, 'action'),
            data_get($step, 'name'),
            data_get($step, 'street'),
        ])->filter(fn ($value) => is_string($value) && trim($value) !== '')->first();

        if (! is_string($text)) {
            return null;
        }

        return [
            'text' => trim($text),
            'distanceMeters' => $length,
            'distanceFromStartMeters' => $distanceFromStart,
        ];
    }

    private function extractStepCoordinates(array $step): array
    {
        $points = data_get($step, 'polyline.points', []);

        if (is_string($points)) {
            return $this->decodePolyline($points);
        }

        if (! is_array($points)) {
            return [];
        }

        return collect($points)
            ->map(function ($point): ?array {
                if (! is_array($point) || count($point) < 2) {
                    return null;
                }

                return [(float) $point[1], (float) $point[0]];
            })
            ->filter()
            ->values()
            ->all();
    }

    private function decodePolyline(string $encoded): array
    {
        $coordinates = [];
        $index = 0;
        $latitude = 0;
        $longitude = 0;
        $length = strlen($encoded);

        while ($index < $length) {
            $latitude += $this->decodePolylineValue($encoded, $index);
            $longitude += $this->decodePolylineValue($encoded, $index);
            $coordinates[] = [$longitude / 100000, $latitude / 100000];
        }

        return $coordinates;
    }

    private function decodePolylineValue(string $encoded, int &$index): int
    {
        $shift = 0;
        $result = 0;

        do {
            $byte = ord($encoded[$index++]) - 63;
            $result |= ($byte & 0x1f) << $shift;
            $shift += 5;
        } while ($byte >= 0x20 && $index < strlen($encoded));

        return ($result & 1) ? ~($result >> 1) : ($result >> 1);
    }

    private function trafficLevel(float $lengthMeters, float $durationSeconds): string
    {
        if ($lengthMeters <= 0 || $durationSeconds <= 0) {
            return 'free';
        }

        $speedKmh = ($lengthMeters / $durationSeconds) * 3.6;

        return match (true) {
            $speedKmh < 8 => 'jam',
            $speedKmh < 18 => 'heavy',
            $speedKmh < 32 => 'slow',
            default => 'free',
        };
    }
}
