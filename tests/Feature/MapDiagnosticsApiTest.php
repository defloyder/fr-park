<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class MapDiagnosticsApiTest extends TestCase
{
    public function test_it_accepts_map_diagnostics_payloads(): void
    {
        Log::shouldReceive('info')
            ->once()
            ->with('Map diagnostics', \Mockery::on(
                fn (array $context): bool => $context['reason'] === 'map_slow_boot'
                    && $context['timings']['mapLoad'] === 4200
                    && $context['counters']['tileFailures'] === 2
            ));

        $this->postJson('/api/map-diagnostics', [
            'reason' => 'map_slow_boot',
            'timings' => ['mapLoad' => 4200],
            'counters' => ['tileFailures' => 2],
            'details' => ['lastTileError' => 'Failed to fetch'],
            'device' => ['effectiveType' => '4g'],
            'page' => '/map',
        ])
            ->assertOk()
            ->assertJsonPath('ok', true);
    }
}
