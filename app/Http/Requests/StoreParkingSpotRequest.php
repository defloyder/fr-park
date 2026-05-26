<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreParkingSpotRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:255'],
            'address' => ['nullable', 'string', 'max:500'],
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'description' => ['nullable', 'string', 'max:2000'],
            'photo_url' => ['nullable', 'string', 'max:1000'],
            'photo_urls' => ['nullable', 'array', 'max:12'],
            'photo_urls.*' => ['string', 'max:1000'],
            'access_instructions' => ['nullable', 'string', 'max:2000'],
            'landmarks' => ['nullable', 'string', 'max:2000'],
            'parking_notes' => ['nullable', 'string', 'max:2000'],
            'availability_status' => ['nullable', Rule::in(['unverified', 'verified', 'temporary', 'outdated'])],
        ];
    }
}
