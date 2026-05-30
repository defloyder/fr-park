<?php

namespace Tests\Feature;

use App\Models\ParkingSpot;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
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

        $token = $this->postJson('/api/session/init')->json('token');

        // Ответ зашифрован — проверяем структуру конверта
        $this->getJson('/api/parking-spots', ['X-Api-Token' => $token])
            ->assertOk()
            ->assertJsonStructure(['iv', 'data', 'tag']);
    }

    public function test_it_creates_pending_user_parking_spot(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/api/parking-spots', [
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

    public function test_guest_cannot_create_parking_spot(): void
    {
        $this->postJson('/api/parking-spots', [
            'title' => 'Гостевая парковка',
            'latitude' => 55.7600000,
            'longitude' => 37.6200000,
        ])
            ->assertUnauthorized();
    }

    public function test_user_can_upload_mobile_camera_photo_with_octet_stream_mime(): void
    {
        Storage::fake('public');

        $user = User::factory()->create();
        $photo = UploadedFile::fake()->create('camera-photo.jpg', 35000, 'application/octet-stream');

        $response = $this->actingAs($user)->post('/api/parking-spots/photo', [
            'photo' => $photo,
        ], ['Accept' => 'application/json']);

        $response->assertOk();
        $this->assertStringContainsString('/storage/parking-spots/', $response->json('url'));

        Storage::disk('public')->assertExists(
            'parking-spots/'.basename(parse_url($response->json('url'), PHP_URL_PATH))
        );
    }

    public function test_user_can_upload_heic_mobile_photo(): void
    {
        Storage::fake('public');

        $user = User::factory()->create();
        $photo = UploadedFile::fake()->create('phone-capture', 1024, 'image/heic');

        $response = $this->actingAs($user)->post('/api/parking-spots/photo', [
            'photo' => $photo,
        ], ['Accept' => 'application/json']);

        $response->assertOk();
        $this->assertStringEndsWith('.heic', parse_url($response->json('url'), PHP_URL_PATH));
    }

    public function test_it_imports_python_like_json_parking_spots(): void
    {
        config(['auralith.admin_email' => 'admin@example.com']);
        $admin = User::factory()->create(['email' => 'admin@example.com']);

        $payload = <<<'JSON'
[
  {
    'name': 'Москва, Ленинский проспект, 20к1',
    'description': 'Порядка 7 автомобилей.',
    'id': 73,
    'lat': 55.7171588,
    'lng': 37.5925154,
    'address_text': None,
    'photos': [
      'photos/5a23b169-fd16-44cd-a764-81338388b3c9.jpg'
    ],
    'hidden_by_user': False
  }
]
JSON;

        $this->actingAs($admin)->postJson('/api/parking-spots/import', [
            'json_text' => $payload,
        ])
            ->assertOk()
            ->assertJsonPath('created_count', 1)
            ->assertJsonPath('data.0.title', 'Москва, Ленинский проспект, 20к1')
            ->assertJsonPath('data.0.source', 'imported')
            ->assertJsonPath('data.0.photo_urls.0', url('/storage/photos/5a23b169-fd16-44cd-a764-81338388b3c9.jpg'));

        $this->assertDatabaseHas('parking_spots', [
            'title' => 'Москва, Ленинский проспект, 20к1',
            'source' => 'imported',
            'status' => 'active',
        ]);
    }

    public function test_import_requires_admin_user(): void
    {
        config(['auralith.admin_email' => 'admin@example.com']);
        $user = User::factory()->create(['email' => 'user@example.com']);

        $this->actingAs($user)->postJson('/api/parking-spots/import', [
            'json_text' => '[]',
        ])
            ->assertForbidden();
    }
}
