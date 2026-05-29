<?php

use App\Http\Controllers\Web\MapController;
use App\Http\Controllers\Web\AdminController;
use App\Http\Controllers\Web\AuthController;
use App\Http\Controllers\Web\FavoriteParkingSpotController;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::get('/', MapController::class)->name('map');

Route::get('/tiles/carto-streets/{z}/{x}/{y}.mvt', function (int $z, int $x, int $y) {
    $response = Http::timeout(8)
        ->get("https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/{$z}/{$x}/{$y}.mvt");

    abort_unless($response->ok(), 502);

    return response($response->body(), 200)
        ->header('Content-Type', 'application/x-protobuf')
        ->header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
        ->header('Access-Control-Allow-Origin', '*');
})->whereNumber(['z', 'x', 'y'])->name('tiles.carto-streets');

Route::middleware('admin')->prefix('aura-vault-7f3c')->name('admin.')->group(function (): void {
    Route::get('/', [AdminController::class, 'index'])->name('index');
    Route::get('/spots', [AdminController::class, 'spots'])->name('spots');
    Route::post('/spots/bulk', [AdminController::class, 'bulk'])->name('spots.bulk');
    Route::get('/users', [AdminController::class, 'users'])->name('users');
    Route::patch('/users/{user}/admin', [AdminController::class, 'toggleAdmin'])->name('users.admin');
});

Route::get('/account/session', [AuthController::class, 'session'])->name('account.session');
Route::post('/account/register', [AuthController::class, 'register'])->name('account.register');
Route::post('/account/login', [AuthController::class, 'login'])->name('account.login');
Route::post('/account/logout', [AuthController::class, 'logout'])->name('account.logout');

Route::middleware('auth')->group(function () {
    Route::get('/account/favorites', [FavoriteParkingSpotController::class, 'index'])->name('account.favorites');
    Route::post('/account/favorites/{parkingSpot}/toggle', [FavoriteParkingSpotController::class, 'toggle'])
        ->name('account.favorites.toggle');
});
