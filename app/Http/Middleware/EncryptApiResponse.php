<?php

namespace App\Http\Middleware;

use App\Services\ApiEncryptionService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class EncryptApiResponse
{
    public function __construct(private ApiEncryptionService $encryption) {}

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $token = $request->header('X-Api-Token');
        if (! $token) {
            return $response;
        }

        $keyB64 = Cache::get('api_session_'.$token);
        if (! $keyB64) {
            return $response;
        }

        $content = $response->getContent();
        if (! $content) {
            return $response;
        }

        try {
            $encrypted = $this->encryption->encrypt($content, base64_decode($keyB64));
            $response->setContent(json_encode($encrypted));
            $response->headers->set('Content-Type', 'application/json');
        } catch (Throwable) {
            // fail open: return unencrypted rather than break the app
        }

        return $response;
    }
}
