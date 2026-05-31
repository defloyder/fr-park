<?php

namespace App\Services;

class NavigationGeometryService
{
    public function distanceMeters(array $origin, array $target): float
    {
        $latitude = (float) data_get($target, 'latitude');
        $longitude = (float) data_get($target, 'longitude');
        $originLatitude = (float) data_get($origin, 'latitude');
        $originLongitude = (float) data_get($origin, 'longitude');

        if (! is_finite($latitude) || ! is_finite($longitude) || ! is_finite($originLatitude) || ! is_finite($originLongitude)) {
            return INF;
        }

        $earthRadius = 6371000;
        $dLat = deg2rad($latitude - $originLatitude);
        $dLng = deg2rad($longitude - $originLongitude);
        $lat1 = deg2rad($originLatitude);
        $lat2 = deg2rad($latitude);
        $a = sin($dLat / 2) ** 2
            + cos($lat1) * cos($lat2) * sin($dLng / 2) ** 2;

        return $earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    public function closestRoutePoint(array $coordinates, array $point): array
    {
        $current = [(float) data_get($point, 'longitude'), (float) data_get($point, 'latitude')];
        $progress = 0.0;
        $best = [
            'distanceMeters' => INF,
            'progressMeters' => 0.0,
            'bearing' => 0.0,
            'longitude' => $current[0],
            'latitude' => $current[1],
        ];

        for ($index = 1; $index < count($coordinates); $index++) {
            $start = $coordinates[$index - 1];
            $finish = $coordinates[$index];
            $segmentDistance = $this->distanceMeters(
                ['longitude' => $start[0], 'latitude' => $start[1]],
                ['longitude' => $finish[0], 'latitude' => $finish[1]],
            );
            $closest = $this->closestPointOnSegment($current, $start, $finish);
            $distanceToSegment = $this->distanceMeters(
                ['longitude' => $current[0], 'latitude' => $current[1]],
                ['longitude' => $closest['coordinate'][0], 'latitude' => $closest['coordinate'][1]],
            );

            if ($distanceToSegment < $best['distanceMeters']) {
                $best = [
                    'distanceMeters' => $distanceToSegment,
                    'progressMeters' => $progress + ($segmentDistance * $closest['ratio']),
                    'bearing' => $this->bearingDegrees($start, $finish),
                    'longitude' => (float) $closest['coordinate'][0],
                    'latitude' => (float) $closest['coordinate'][1],
                ];
            }

            $progress += $segmentDistance;
        }

        return $best;
    }

    public function bearingDegrees(array $start, array $finish): float
    {
        $startLat = deg2rad((float) $start[1]);
        $finishLat = deg2rad((float) $finish[1]);
        $deltaLng = deg2rad((float) $finish[0] - (float) $start[0]);
        $y = sin($deltaLng) * cos($finishLat);
        $x = cos($startLat) * sin($finishLat)
            - sin($startLat) * cos($finishLat) * cos($deltaLng);

        return fmod(rad2deg(atan2($y, $x)) + 360, 360);
    }

    public function angleDifference(float $first, float $second): float
    {
        return abs(fmod($first - $second + 540, 360) - 180);
    }

    public function routeBounds(array $coordinates, float $paddingDegrees = 0): array
    {
        $longitudes = collect($coordinates)->map(fn ($coordinate) => (float) $coordinate[0])->filter(fn ($value) => is_finite($value));
        $latitudes = collect($coordinates)->map(fn ($coordinate) => (float) $coordinate[1])->filter(fn ($value) => is_finite($value));

        return [
            'west' => $longitudes->min() - $paddingDegrees,
            'east' => $longitudes->max() + $paddingDegrees,
            'south' => $latitudes->min() - $paddingDegrees,
            'north' => $latitudes->max() + $paddingDegrees,
        ];
    }

    private function closestPointOnSegment(array $point, array $start, array $finish): array
    {
        $dx = (float) $finish[0] - (float) $start[0];
        $dy = (float) $finish[1] - (float) $start[1];
        $lengthSquared = ($dx ** 2) + ($dy ** 2);

        if ($lengthSquared <= 0) {
            return ['coordinate' => $start, 'ratio' => 0.0];
        }

        $ratio = max(0, min(1, (((float) $point[0] - (float) $start[0]) * $dx + ((float) $point[1] - (float) $start[1]) * $dy) / $lengthSquared));

        return [
            'coordinate' => [
                (float) $start[0] + ($dx * $ratio),
                (float) $start[1] + ($dy * $ratio),
            ],
            'ratio' => $ratio,
        ];
    }
}
