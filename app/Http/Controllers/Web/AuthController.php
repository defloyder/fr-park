<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function session(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'user' => $user ? [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'is_admin' => $user->isAdmin(),
            ] : null,
            'favorite_ids' => $user
                ? $user->favoriteParkingSpots()->pluck('parking_spots.id')->values()
                : [],
            'csrf_token' => csrf_token(),
        ]);
    }

    public function register(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
        ]);

        $user = User::create($validated);

        Auth::login($user);
        $request->session()->regenerate();

        return $this->session($request);
    }

    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        if (! Auth::attempt($credentials, true)) {
            throw ValidationException::withMessages([
                'email' => 'Не удалось войти с этими данными.',
            ]);
        }

        $request->session()->regenerate();

        return $this->session($request);
    }

    public function logout(Request $request): JsonResponse
    {
        Auth::logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json([
            'user' => null,
            'favorite_ids' => [],
            'is_admin' => false,
            'csrf_token' => csrf_token(),
        ]);
    }
}
