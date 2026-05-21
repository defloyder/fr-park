<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateParkingSpotRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'title' => ['sometimes', 'required', 'string', 'max:255'],
            'address' => ['sometimes', 'nullable', 'string', 'max:500'],
            'latitude' => ['sometimes', 'required', 'numeric', 'between:-90,90'],
            'longitude' => ['sometimes', 'required', 'numeric', 'between:-180,180'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'photo_url' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'photo_urls' => ['sometimes', 'nullable', 'array', 'max:12'],
            'photo_urls.*' => ['string', 'max:1000'],
            'access_instructions' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'landmarks' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'parking_notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'availability_status' => ['sometimes', Rule::in(['unverified', 'verified', 'temporary', 'outdated'])],
            'status' => ['sometimes', Rule::in(['active', 'hidden', 'pending'])],
            'source' => ['sometimes', Rule::in(['manual', 'user', 'imported'])],
            'is_verified' => ['sometimes', 'boolean'],
        ];
    }
}
