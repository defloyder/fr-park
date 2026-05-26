<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\ApiEncryptionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

class SessionController extends Controller
{
    public function __construct(private ApiEncryptionService $encryption) {}

    /**
     * Issue a short-lived session token and AES key for encrypted API access.
     * The key is sent once over HTTPS; subsequent requests use only the token.
     */
    public function init(): JsonResponse
    {
        $token = $this->encryption->generateToken();
        $key   = $this->encryption->generateKey();

        Cache::put('api_session_'.$token, base64_encode($key), now()->addHour());

        return response()->json([
            'token' => $token,
            'key'   => base64_encode($key),
        ]);
    }
}
