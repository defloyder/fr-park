<?php

namespace Tests\Feature;

use App\Models\ParkingSpot;
use App\Services\ApiEncryptionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class ApiEncryptionTest extends TestCase
{
    use RefreshDatabase;

    // -----------------------------------------------------------------------
    // session/init
    // -----------------------------------------------------------------------

    public function test_session_init_returns_token_and_key(): void
    {
        $this->postJson('/api/session/init')
            ->assertOk()
            ->assertJsonStructure(['token', 'key']);
    }

    public function test_session_init_stores_key_in_cache(): void
    {
        $response = $this->postJson('/api/session/init')->assertOk();

        $token = $response->json('token');

        $this->assertTrue(Cache::has('api_session_'.$token));
    }

    public function test_session_init_rate_limited(): void
    {
        for ($i = 0; $i < 31; $i++) {
            $response = $this->postJson('/api/session/init');
        }

        $response->assertTooManyRequests();
    }

    // -----------------------------------------------------------------------
    // GET /api/parking-spots — требует токен
    // -----------------------------------------------------------------------

    public function test_parking_spots_without_token_returns_401(): void
    {
        $this->getJson('/api/parking-spots')
            ->assertUnauthorized()
            ->assertJsonFragment(['error' => 'Invalid or expired session token.']);
    }

    public function test_parking_spots_with_invalid_token_returns_401(): void
    {
        $this->getJson('/api/parking-spots', ['X-Api-Token' => 'fake-token'])
            ->assertUnauthorized();
    }

    public function test_parking_spots_with_valid_token_returns_encrypted_blob(): void
    {
        $token = $this->issueToken();

        $response = $this->getJson('/api/parking-spots', ['X-Api-Token' => $token])
            ->assertOk()
            ->assertJsonStructure(['iv', 'data', 'tag']);

        // Убеждаемся, что это НЕ обычный JSON с точками
        $this->assertArrayNotHasKey('data.0.latitude', $response->json());
    }

    // -----------------------------------------------------------------------
    // Расшифровка — убеждаемся что данные корректны
    // -----------------------------------------------------------------------

    public function test_decrypted_response_contains_parking_spots(): void
    {
        ParkingSpot::create([
            'title'     => 'Тестовая парковка',
            'latitude'  => 55.7558,
            'longitude' => 37.6173,
            'status'    => 'active',
        ]);

        [$token, $key] = $this->issueTokenWithKey();

        $encrypted = $this->getJson('/api/parking-spots', ['X-Api-Token' => $token])
            ->assertOk()
            ->json();

        $plaintext = $this->decryptPayload($encrypted, $key);
        $spots = json_decode($plaintext, true);

        $this->assertArrayHasKey('data', $spots);
        $this->assertCount(1, $spots['data']);
        $this->assertSame('Тестовая парковка', $spots['data'][0]['title']);
        $this->assertSame(55.7558, $spots['data'][0]['latitude']);
    }

    public function test_each_response_has_unique_iv(): void
    {
        ParkingSpot::create([
            'title'     => 'Spot',
            'latitude'  => 55.7,
            'longitude' => 37.6,
            'status'    => 'active',
        ]);

        [$token] = $this->issueTokenWithKey();

        $iv1 = $this->getJson('/api/parking-spots', ['X-Api-Token' => $token])->json('iv');
        $iv2 = $this->getJson('/api/parking-spots', ['X-Api-Token' => $token])->json('iv');

        $this->assertNotSame($iv1, $iv2, 'IV должен быть случайным для каждого ответа');
    }

    // -----------------------------------------------------------------------
    // GET /api/parking-spots/{id} — тоже зашифрован
    // -----------------------------------------------------------------------

    public function test_show_requires_token(): void
    {
        $spot = ParkingSpot::create([
            'title'     => 'Spot',
            'latitude'  => 55.7,
            'longitude' => 37.6,
            'status'    => 'active',
        ]);

        $this->getJson('/api/parking-spots/'.$spot->id)
            ->assertUnauthorized();
    }

    public function test_show_returns_encrypted_blob(): void
    {
        $spot = ParkingSpot::create([
            'title'     => 'Spot',
            'latitude'  => 55.7,
            'longitude' => 37.6,
            'status'    => 'active',
        ]);

        $token = $this->issueToken();

        $this->getJson('/api/parking-spots/'.$spot->id, ['X-Api-Token' => $token])
            ->assertOk()
            ->assertJsonStructure(['iv', 'data', 'tag']);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private function issueToken(): string
    {
        return $this->postJson('/api/session/init')->json('token');
    }

    /** @return array{string, string} [token, raw_key_bytes] */
    private function issueTokenWithKey(): array
    {
        $response = $this->postJson('/api/session/init')->json();
        $token = $response['token'];
        $key   = base64_decode($response['key']);
        return [$token, $key];
    }

    private function decryptPayload(array $payload, string $key): string
    {
        $iv         = base64_decode($payload['iv']);
        $ciphertext = base64_decode($payload['data']);
        $tag        = base64_decode($payload['tag']);

        $plaintext = openssl_decrypt(
            $ciphertext,
            'aes-256-gcm',
            $key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
        );

        $this->assertNotFalse($plaintext, 'Расшифровка не удалась — ключ или тег неверны');

        return $plaintext;
    }
}
