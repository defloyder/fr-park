<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Http\Resources\ParkingSpotResource;
use App\Models\ParkingSpot;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class FavoriteParkingSpotController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $spots = $request->user()
            ->favoriteParkingSpots()
            ->whereIn('status', ['active', 'pending'])
            ->latest('favorite_parking_spot.created_at')
            ->get();

        return ParkingSpotResource::collection($spots);
    }

    public function toggle(Request $request, ParkingSpot $parkingSpot): JsonResponse
    {
        abort_if($parkingSpot->status === 'hidden', 404);

        $user = $request->user();
        $isFavorite = $user->favoriteParkingSpots()
            ->where('parking_spots.id', $parkingSpot->id)
            ->exists();

        if ($isFavorite) {
            $user->favoriteParkingSpots()->detach($parkingSpot->id);
        } else {
            $user->favoriteParkingSpots()->attach($parkingSpot->id);
        }

        return response()->json([
            'is_favorite' => ! $isFavorite,
            'favorite_ids' => $user->favoriteParkingSpots()->pluck('parking_spots.id')->values(),
        ]);
    }
}
