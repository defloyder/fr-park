<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class GeocodeController extends Controller
{
    public function reverse(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $key = config('services.yandex_maps.key');

        if (! $key) {
            return response()->json(['address' => '']);
        }

        try {
            $address = $this->resolveAddress(
                (float) $validated['latitude'],
                (float) $validated['longitude'],
                $key
            );
        } catch (RequestException) {
            $address = '';
        }

        return response()->json([
            'address' => $address,
        ]);
    }

    private function resolveAddress(float $latitude, float $longitude, string $key): string
    {
        foreach (['house', 'street', null] as $kind) {
            $response = Http::timeout(8)
                ->retry(2, 150)
                ->get('https://geocode-maps.yandex.ru/1.x/', array_filter([
                    'apikey' => $key,
                    'format' => 'json',
                    'lang' => 'ru_RU',
                    'geocode' => $longitude.','.$latitude,
                    'kind' => $kind,
                    'results' => 5,
                ]))
                ->throw()
                ->json();

            $address = $this->extractAddress($response);

            if ($address !== '') {
                return $address;
            }
        }

        return '';
    }

    private function extractAddress(array $response): string
    {
        $members = data_get($response, 'response.GeoObjectCollection.featureMember', []);

        foreach ($members as $member) {
            $geoObject = data_get($member, 'GeoObject', []);
            $address = data_get($geoObject, 'metaDataProperty.GeocoderMetaData.text')
                ?: data_get($geoObject, 'description')
                ?: data_get($geoObject, 'name');

            if (is_string($address) && trim($address) !== '') {
                return trim($address);
            }
        }

        return '';
    }
}
