<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SpeedCameraService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class SpeedCameraController extends Controller
{
    public function __invoke(Request $request, SpeedCameraService $speedCameras): JsonResponse
    {
        try {
            $validated = $request->validate([
                'coordinates' => ['required', 'array', 'min:2', 'max:1200'],
                'coordinates.*' => ['required', 'array', 'size:2'],
                'coordinates.*.0' => ['required', 'numeric', 'between:-180,180'],
                'coordinates.*.1' => ['required', 'numeric', 'between:-90,90'],
            ]);

            return response()->json([
                'data' => $speedCameras->camerasForRoute($validated['coordinates']),
            ]);
        } catch (\Throwable $exception) {
            Log::warning('Speed camera lookup failed', [
                'message' => $exception->getMessage(),
            ]);

            return response()->json([
                'data' => [],
                'message' => 'Speed cameras are unavailable.',
                'unavailable' => true,
            ]);
        }
    }
}
