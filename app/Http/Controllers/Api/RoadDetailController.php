<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\RoadDetailService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class RoadDetailController extends Controller
{
    public function __invoke(Request $request, RoadDetailService $roadDetails): JsonResponse
    {
        $validated = $request->validate([
            'south' => ['required', 'numeric', 'between:-90,90'],
            'west' => ['required', 'numeric', 'between:-180,180'],
            'north' => ['required', 'numeric', 'between:-90,90'],
            'east' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $bounds = collect($validated)->map(fn ($value) => (float) $value)->all();

        if ($bounds['south'] >= $bounds['north']
            || $bounds['west'] >= $bounds['east']
            || ($bounds['north'] - $bounds['south']) > 0.08
            || ($bounds['east'] - $bounds['west']) > 0.12) {
            return response()->json(['message' => 'Visible map bounds are too large.'], 422);
        }

        try {
            return response()
                ->json([
                    'type' => 'FeatureCollection',
                    'features' => $roadDetails->featuresForBounds($bounds),
                ])
                ->header('Cache-Control', 'public, max-age=300');
        } catch (\Throwable $exception) {
            Log::warning('Road detail lookup failed', ['message' => $exception->getMessage()]);

            return response()
                ->json([
                    'type' => 'FeatureCollection',
                    'features' => [],
                    'unavailable' => true,
                ])
                ->header('Cache-Control', 'public, max-age=30');
        }
    }
}
