<?php

namespace App\Services;

use App\Models\ParkingSpot;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ParkingSpotPhotoService
{
    /**
     * @return array{photo_url: ?string, photo_urls: array<int, string>}
     */
    public function resolveForSpot(ParkingSpot $spot, Request $request): array
    {
        $photos = collect($spot->photo_urls ?? [])
            ->push($spot->photo_url)
            ->filter()
            ->map(fn (string $photo) => $this->resolve($photo, $request))
            ->filter()
            ->unique()
            ->values()
            ->all();

        return [
            'photo_url' => $photos[0] ?? null,
            'photo_urls' => $photos,
        ];
    }

    public function resolve(?string $photo, Request $request): ?string
    {
        if (! $photo) {
            return null;
        }

        $photo = trim($photo);
        $isAbsolute = Str::startsWith($photo, ['http://', 'https://']);
        $parts = $isAbsolute ? parse_url($photo) : null;
        $host = $parts['host'] ?? null;
        $localHosts = array_filter([
            config('app.ip'),
            config('app.domain'),
            $request->getHost(),
        ]);
        $isLocal = ! $isAbsolute || ($host && in_array($host, $localHosts, true));
        $path = $isAbsolute ? ($parts['path'] ?? '') : '/'.ltrim($photo, '/');

        if ($isLocal && ! $this->localStorageFileExists($path)) {
            return null;
        }

        if (! $isLocal) {
            return $photo;
        }

        $query = $isAbsolute && isset($parts['query']) ? '?'.$parts['query'] : '';

        return $request->getSchemeAndHttpHost().$path.$query;
    }

    private function localStorageFileExists(string $path): bool
    {
        if (! Str::startsWith($path, '/storage/')) {
            return true;
        }

        $relativePath = rawurldecode(Str::after($path, '/storage/'));

        if ($relativePath === '' || Str::contains($relativePath, ['..', '\\'])) {
            return false;
        }

        return Storage::disk('public')->exists($relativePath);
    }
}
