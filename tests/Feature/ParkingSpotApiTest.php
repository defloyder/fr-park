<?php

namespace Tests\Feature;

use App\Models\ParkingSpot;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ParkingSpotApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_lists_visible_parking_spots(): void
    {
        ParkingSpot::create([
            'title' => 'Active spot',
            'latitude' => 55.7558000,
            'longitude' => 37.6173000,
            'status' => 'active',
        ]);

        ParkingSpot::create([
            'title' => 'Pending spot',
            'latitude' => 55.7522000,
            'longitude' => 37.5931000,
            'status' => 'pending',
        ]);

        ParkingSpot::create([
            'title' => 'Hidden spot',
            'latitude' => 55.7697000,
            'longitude' => 37.6492000,
            'status' => 'hidden',
        ]);

        $this->getJson('/api/parking-spots')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonFragment(['title' => 'Active spot'])
            ->assertJsonFragment(['title' => 'Pending spot'])
            ->assertJsonFragment(['yandex_route_url' => 'https://yandex.ru/maps/?rtext=~55.7558000,37.6173000&rtt=auto']);
    }

    public function test_it_creates_pending_user_parking_spot(): void
    {
        $this->postJson('/api/parking-spots', [
            'title' => 'Новая парковка',
            'address' => 'Москва, тестовый адрес',
            'latitude' => 55.7600000,
            'longitude' => 37.6200000,
            'description' => 'Тестовая точка',
        ])
            ->assertCreated()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.source', 'user')
            ->assertJsonPath('data.is_verified', false);

        $this->assertDatabaseHas('parking_spots', [
            'title' => 'Новая парковка',
            'status' => 'pending',
            'source' => 'user',
        ]);
    }
}
