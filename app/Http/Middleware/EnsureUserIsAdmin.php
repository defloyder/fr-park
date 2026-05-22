<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserIsAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()?->isAdmin()) {
            return response()->json([
                'message' => 'Доступ только для администратора.',
            ], $request->user() ? 403 : 401);
        }

        return $next($request);
    }
}
