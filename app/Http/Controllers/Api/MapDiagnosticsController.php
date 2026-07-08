<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ServiceMetricsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class MapDiagnosticsController extends Controller
{
    public function __invoke(Request $request, ServiceMetricsService $metrics): JsonResponse
    {
        $validated = $request->validate([
            'reason' => ['required', 'string', 'max:80'],
            'timings' => ['sometimes', 'array'],
            'counters' => ['sometimes', 'array'],
            'details' => ['sometimes', 'array'],
            'device' => ['sometimes', 'array'],
            'page' => ['sometimes', 'string', 'max:255'],
        ]);

        Log::info('Map diagnostics', [
            'reason' => $validated['reason'],
            'timings' => $validated['timings'] ?? [],
            'counters' => $validated['counters'] ?? [],
            'details' => $validated['details'] ?? [],
            'device' => $validated['device'] ?? [],
            'page' => $validated['page'] ?? '',
            'ip' => $request->ip(),
            'user_agent' => substr((string) $request->userAgent(), 0, 255),
        ]);

        $metrics->recordMapDiagnostic($validated);

        return response()->json(['ok' => true]);
    }
}
