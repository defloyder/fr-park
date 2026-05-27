<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
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

        $apiKey = config('services.yandex_router.key');

        if (! is_string($apiKey) || trim($apiKey) === '') {
            return response()->json([
                'message' => 'Yandex Router API key is not configured.',
            ], 503);
        }

        try {
            $response = Http::timeout(14)
                ->acceptJson()
                ->get('https://api.routing.yandex.net/v2/route', [
                    'apikey' => $apiKey,
                    'waypoints' => implode('|', [
                        $validated['from_longitude'].','.$validated['from_latitude'],
                        $validated['to_longitude'].','.$validated['to_latitude'],
                    ]),
                    'mode' => 'driving',
                    'traffic' => 'realtime',
                ])
                ->throw()
                ->json();

            $route = data_get($response, 'route') ?: data_get($response, 'routes.0');

            if (! is_array($route)) {
                return response()->json([
                    'message' => 'Yandex Router API returned an empty route.',
                ], 502);
            }

            return response()->json($this->normalizeRoute($route));
        } catch (Throwable) {
            return response()->json([
                'message' => 'Failed to build Yandex traffic route.',
            ], 502);
        }
    }

    private function normalizeRoute(array $route): array
    {
        $segments = [];
        $coordinates = [];
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

            $segments[] = [
                'traffic' => $traffic,
                'coordinates' => $points,
            ];

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
            'distanceMeters' => $distanceMeters,
            'durationSeconds' => $durationSeconds,
            'source' => 'yandex-traffic',
            'trafficType' => data_get($route, 'traffic_type'),
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
