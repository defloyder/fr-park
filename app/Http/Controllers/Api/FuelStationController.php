<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\FuelStationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class FuelStationController extends Controller
{
    public function __invoke(Request $request, FuelStationService $fuelStations): JsonResponse
    {
        $validated = $request->validate([
            'west' => ['required', 'numeric', 'between:-180,180'],
            'south' => ['required', 'numeric', 'between:-90,90'],
            'east' => ['required', 'numeric', 'between:-180,180'],
            'north' => ['required', 'numeric', 'between:-90,90'],
        ]);

        $west = (float) $validated['west'];
        $south = (float) $validated['south'];
        $east = (float) $validated['east'];
        $north = (float) $validated['north'];

        abort_if($east <= $west || $north <= $south, 422, 'Некорректная область карты.');
        abort_if(($east - $west) > 2.5 || ($north - $south) > 2.5, 422, 'Увеличьте масштаб карты.');

        try {
            $result = $fuelStations->stationsForBounds($west, $south, $east, $north);

            return response()->json([
                'data' => $result['data'],
                'meta' => [
                    'source' => $result['source'],
                    'pricesNotice' => 'Цены отображаются только когда источник публикует их для выбранной АЗС.',
                ],
            ]);
        } catch (\Throwable $exception) {
            Log::warning('Fuel station lookup failed', [
                'message' => $exception->getMessage(),
            ]);

            return response()->json([
                'data' => [],
                'message' => 'Данные заправок временно недоступны.',
                'unavailable' => true,
            ], 503);
        }
    }
}
