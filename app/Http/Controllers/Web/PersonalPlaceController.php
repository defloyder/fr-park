<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\PersonalPlace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PersonalPlaceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'personal_places' => $this->places($request),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'address' => ['nullable', 'string', 'max:1000'],
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $place = $request->user()->personalPlaces()->updateOrCreate(
            [
                'latitude' => round((float) $validated['latitude'], 7),
                'longitude' => round((float) $validated['longitude'], 7),
            ],
            [
                'title' => $validated['title'],
                'address' => $validated['address'] ?? null,
            ],
        );

        return response()->json([
            'place' => $this->serialize($place),
            'personal_places' => $this->places($request),
        ], 201);
    }

    public function sync(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'places' => ['required', 'array', 'max:50'],
            'places.*.title' => ['required', 'string', 'max:255'],
            'places.*.address' => ['nullable', 'string', 'max:1000'],
            'places.*.latitude' => ['required', 'numeric', 'between:-90,90'],
            'places.*.longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        foreach ($validated['places'] as $place) {
            $exists = $request->user()->personalPlaces()
                ->where('latitude', round((float) $place['latitude'], 7))
                ->where('longitude', round((float) $place['longitude'], 7))
                ->exists();

            if (! $exists) {
                $request->user()->personalPlaces()->create($place);
            }
        }

        return response()->json([
            'personal_places' => $this->places($request),
        ]);
    }

    public function destroy(Request $request, PersonalPlace $personalPlace): JsonResponse
    {
        abort_unless($personalPlace->user_id === $request->user()->id, 404);

        $personalPlace->delete();

        return response()->json([
            'personal_places' => $this->places($request),
        ]);
    }

    private function places(Request $request): array
    {
        return $request->user()
            ->personalPlaces()
            ->latest()
            ->limit(50)
            ->get()
            ->map(fn (PersonalPlace $place): array => $this->serialize($place))
            ->all();
    }

    private function serialize(PersonalPlace $place): array
    {
        return [
            'id' => (string) $place->id,
            'title' => $place->title,
            'address' => $place->address,
            'latitude' => (float) $place->latitude,
            'longitude' => (float) $place->longitude,
        ];
    }
}
