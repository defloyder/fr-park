<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ParkingSpot extends Model
{
    use HasFactory;

    protected $fillable = [
        'title',
        'address',
        'latitude',
        'longitude',
        'description',
        'photo_url',
        'photo_urls',
        'access_instructions',
        'landmarks',
        'parking_notes',
        'status',
        'source',
        'is_verified',
        'availability_status',
    ];

    protected function casts(): array
    {
        return [
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'is_verified' => 'boolean',
            'photo_urls' => 'array',
        ];
    }
}
