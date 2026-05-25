<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ParkingSpotResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $photos = collect($this->photo_urls ?? [])
            ->filter()
            ->values();

        if ($photos->isEmpty() && $this->photo_url) {
            $photos = collect([$this->photo_url]);
        }

        return [
            'id' => $this->id,
            'title' => $this->title,
            'address' => $this->address,
            'latitude' => (float) $this->latitude,
            'longitude' => (float) $this->longitude,
            'description' => $this->description,
            'photo_url' => $this->normalizePhotoUrl($this->photo_url, $request),
            'photo_urls' => $photos->map(fn (string $photo) => $this->normalizePhotoUrl($photo, $request))->filter()->values()->all(),
            'access_instructions' => $this->access_instructions,
            'landmarks' => $this->landmarks,
            'parking_notes' => $this->parking_notes,
            'status' => $this->status,
            'source' => $this->source,
            'is_verified' => (bool) $this->is_verified,
            'availability_status' => $this->availability_status,
            'availability_label' => match ($this->availability_status) {
                'verified' => 'Проверено',
                'temporary' => 'Временная',
                'outdated' => 'Неактуально',
                default => 'Не проверено',
            },
            'yandex_route_url' => sprintf(
                'https://yandex.ru/maps/?rtext=~%s,%s&rtt=auto',
                $this->latitude,
                $this->longitude
            ),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }

    private function normalizePhotoUrl(?string $photo, Request $request): ?string
    {
        if (! $photo) {
            return null;
        }

        $photo = trim($photo);

        if (str_starts_with($photo, 'http://') || str_starts_with($photo, 'https://')) {
            $parts = parse_url($photo);
            $appIp = config('app.ip');
            $appDomain = config('app.domain');
            $host = $parts['host'] ?? null;
            $path = $parts['path'] ?? '';

            if ($host && in_array($host, array_filter([$appIp, $appDomain, $request->getHost()]), true)) {
                $query = isset($parts['query']) ? '?'.$parts['query'] : '';

                return $request->getSchemeAndHttpHost().$path.$query;
            }

            return $photo;
        }

        return $request->getSchemeAndHttpHost().'/'.ltrim($photo, '/');
    }
}
