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
            if (! $request->expectsJson()) {
                return redirect('/')->with('admin_error', 'Войдите под администратором.');
            }

            return response()->json([
                'message' => 'Доступ только для администратора.',
            ], $request->user() ? 403 : 401);
        }

        return $next($request);
    }
}
