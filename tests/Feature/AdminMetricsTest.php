<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminMetricsTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_open_service_metrics_even_when_redis_is_unavailable(): void
    {
        config(['auralith.admin_email' => 'admin@example.com']);

        $admin = User::factory()->create(['email' => 'admin@example.com']);

        $this->actingAs($admin)->getJson('/aura-vault-7f3c/metrics')
            ->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'generated_at',
                    'cache' => [
                        'default_store',
                        'session_driver',
                        'queue_connection',
                        'redis' => ['available'],
                    ],
                    'map' => [
                        'last_hour',
                        'last_day',
                        'total',
                        'latest',
                    ],
                ],
            ]);
    }
}
