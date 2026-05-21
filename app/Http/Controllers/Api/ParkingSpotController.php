<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreParkingSpotRequest;
use App\Http\Requests\UpdateParkingSpotRequest;
use App\Http\Resources\ParkingSpotResource;
use App\Models\ParkingSpot;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class ParkingSpotController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        $spots = ParkingSpot::query()
            ->whereIn('status', ['active', 'pending'])
            ->latest('is_verified')
            ->latest()
            ->get();

        return ParkingSpotResource::collection($spots);
    }

    public function store(StoreParkingSpotRequest $request): ParkingSpotResource
    {
        $spot = ParkingSpot::create([
            ...$request->validated(),
            'status' => 'pending',
            'source' => 'user',
            'is_verified' => $request->validated('availability_status') === 'verified',
        ]);

        return ParkingSpotResource::make($spot);
    }

    public function show(ParkingSpot $parkingSpot): ParkingSpotResource
    {
        abort_if($parkingSpot->status === 'hidden', 404);

        return ParkingSpotResource::make($parkingSpot);
    }

    public function update(UpdateParkingSpotRequest $request, ParkingSpot $parkingSpot): ParkingSpotResource
    {
        $validated = $request->validated();

        if (array_key_exists('availability_status', $validated)) {
            $validated['is_verified'] = $validated['availability_status'] === 'verified';
        }

        $parkingSpot->update($validated);

        return ParkingSpotResource::make($parkingSpot->refresh());
    }

    public function destroy(ParkingSpot $parkingSpot): Response
    {
        $parkingSpot->update(['status' => 'hidden']);

        return response()->noContent();
    }

    public function uploadPhoto(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'photo' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ]);

        $path = $validated['photo']->store('parking-spots', 'public');

        return response()->json([
            'url' => '/storage/'.$path,
        ]);
    }
}
