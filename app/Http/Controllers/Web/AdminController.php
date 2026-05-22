<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Http\Resources\ParkingSpotResource;
use App\Models\ParkingSpot;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class AdminController extends Controller
{
    public function index(): View
    {
        return view('pages.admin');
    }

    public function spots(): JsonResponse
    {
        $spots = ParkingSpot::query()
            ->latest()
            ->get();

        return response()->json([
            'data' => ParkingSpotResource::collection($spots)->resolve(),
        ]);
    }

    public function bulk(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:500'],
            'ids.*' => ['integer', 'exists:parking_spots,id'],
            'action' => ['required', 'in:hide,activate,status'],
            'availability_status' => ['required_if:action,status', 'in:verified,unverified,temporary,outdated'],
        ]);

        $query = ParkingSpot::query()->whereIn('id', $validated['ids']);

        match ($validated['action']) {
            'hide' => $query->update(['status' => 'hidden']),
            'activate' => $query->update(['status' => 'active']),
            'status' => $query->update([
                'availability_status' => $validated['availability_status'],
                'is_verified' => $validated['availability_status'] === 'verified',
            ]),
        };

        return response()->json([
            'updated_count' => count($validated['ids']),
            'data' => ParkingSpotResource::collection(
                ParkingSpot::query()->whereIn('id', $validated['ids'])->get()
            )->resolve(),
        ]);
    }
}
