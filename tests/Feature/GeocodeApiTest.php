<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class GeocodeApiTest extends TestCase
{
    public function test_reverse_geocode_returns_empty_address_when_providers_fail(): void
    {
        Http::fake(fn () => throw new \RuntimeException('Network is down'));

        $this->getJson('/api/geocode/reverse?latitude=55.72015986169814&longitude=37.62612623912469')
            ->assertOk()
            ->assertJsonPath('address', '');
    }
}
