<?php

namespace Tests\Feature;

use App\Models\ParkingSpot;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AccountFeatureTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_register_and_favorite_parking_spot(): void
    {
        $spot = ParkingSpot::create([
            'title' => 'Favorite spot',
            'latitude' => 55.7558000,
            'longitude' => 37.6173000,
            'status' => 'active',
        ]);

        $this->postJson('/account/register', [
            'name' => 'Денис',
            'email' => 'denis@example.com',
            'password' => 'password123',
        ])
            ->assertOk()
            ->assertJsonPath('user.email', 'denis@example.com')
            ->assertJsonPath('favorite_ids', []);

        $this->postJson("/account/favorites/{$spot->id}/toggle")
            ->assertOk()
            ->assertJsonPath('is_favorite', true)
            ->assertJsonPath('favorite_ids.0', $spot->id);

        $this->getJson('/account/favorites')
            ->assertOk()
            ->assertJsonPath('data.0.id', $spot->id);
    }
}
