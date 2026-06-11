<?php

namespace App\Http\Resources;

use App\Services\ParkingSpotPhotoService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ParkingSpotResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $photos = app(ParkingSpotPhotoService::class)->resolveForSpot($this->resource, $request);

        return [
            'id' => $this->id,
            'title' => $this->title,
            'address' => $this->address,
            'latitude' => (float) $this->latitude,
            'longitude' => (float) $this->longitude,
            'description' => $this->description,
            'photo_url' => $photos['photo_url'],
            'photo_urls' => $photos['photo_urls'],
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
            'route_url' => sprintf(
                'https://www.openstreetmap.org/directions?to=%s,%s',
                $this->latitude,
                $this->longitude
            ),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
