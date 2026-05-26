<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class ValidateApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->header('X-Api-Token');

        if (! $token || ! Cache::has('api_session_'.$token)) {
            return response()->json(['error' => 'Invalid or expired session token.'], 401);
        }

        return $next($request);
    }
}
