<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Http\Resources\ParkingSpotResource;
use App\Models\ParkingSpot;
use App\Models\User;
use App\Services\ServiceMetricsService;
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

    public function users(): JsonResponse
    {
        return response()->json([
            'data' => User::query()
                ->latest()
                ->get()
                ->map(fn (User $user) => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'is_admin' => $user->isAdmin(),
                    'is_root_admin' => $this->isRootAdmin($user),
                    'created_at' => $user->created_at?->toISOString(),
                ])
                ->values(),
        ]);
    }

    public function metrics(ServiceMetricsService $metrics): JsonResponse
    {
        return response()->json([
            'data' => $metrics->snapshot(),
        ]);
    }

    public function toggleAdmin(Request $request, User $user): JsonResponse
    {
        if ($this->isRootAdmin($user)) {
            return response()->json([
                'message' => 'Главного администратора нельзя снять через панель.',
            ], 422);
        }

        $validated = $request->validate([
            'is_admin' => ['required', 'boolean'],
        ]);

        $user->update(['is_admin' => $validated['is_admin']]);

        return response()->json([
            'data' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'is_admin' => $user->isAdmin(),
                'is_root_admin' => false,
                'created_at' => $user->created_at?->toISOString(),
            ],
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

    private function isRootAdmin(User $user): bool
    {
        $adminEmail = config('auralith.admin_email');

        return is_string($adminEmail)
            && trim($adminEmail) !== ''
            && strcasecmp(trim($user->email), trim($adminEmail)) === 0;
    }
}
