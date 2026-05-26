<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Throwable;

class GeocodeController extends Controller
{
    public function reverse(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $address = $this->resolveAddressWithOpenStreetMap(
            (float) $validated['latitude'],
            (float) $validated['longitude'],
        );

        return response()->json([
            'address' => $address,
        ]);
    }

    private function resolveAddressWithOpenStreetMap(float $latitude, float $longitude): string
    {
        try {
            $response = Http::timeout(8)
                ->withoutVerifying()
                ->withHeaders([
                    'User-Agent' => 'AuralithMaps/1.0',
                ])
                ->get('https://nominatim.openstreetmap.org/reverse', [
                    'format' => 'jsonv2',
                    'lat' => $latitude,
                    'lon' => $longitude,
                    'zoom' => 18,
                    'addressdetails' => 1,
                    'accept-language' => 'ru',
                ])
                ->throw()
                ->json();

            return $this->extractOpenStreetMapAddress($response);
        } catch (Throwable) {
            return '';
        }
    }

    private function extractOpenStreetMapAddress(array $response): string
    {
        $address = data_get($response, 'address', []);
        $road = data_get($address, 'road')
            ?: data_get($address, 'pedestrian')
            ?: data_get($address, 'footway')
            ?: data_get($address, 'path');
        $houseNumber = data_get($address, 'house_number');
        $city = data_get($address, 'city')
            ?: data_get($address, 'town')
            ?: data_get($address, 'municipality')
            ?: 'Москва';

        $parts = collect([$city, trim(collect([$road, $houseNumber])->filter()->join(', '))])
            ->filter()
            ->values();

        if ($parts->isNotEmpty()) {
            return $parts->join(', ');
        }

        $displayName = data_get($response, 'display_name');

        return is_string($displayName) ? trim($displayName) : '';
    }
}
