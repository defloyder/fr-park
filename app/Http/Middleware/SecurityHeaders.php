<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('Content-Security-Policy', implode('; ', [
            "default-src 'self'",
            "base-uri 'self'",
            "connect-src 'self' https: wss:",
            "font-src 'self' data: https://tiles.openfreemap.org",
            "frame-ancestors 'self'",
            "img-src 'self' data: blob: https:",
            "manifest-src 'self'",
            "object-src 'none'",
            "script-src 'self' 'wasm-unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "worker-src 'self' blob:",
        ]));
        $response->headers->set('Permissions-Policy', 'camera=(self), geolocation=(self), screen-wake-lock=(self)');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'SAMEORIGIN');

        return $response;
    }
}
