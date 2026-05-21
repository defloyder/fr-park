<?php

use App\Http\Controllers\Web\MapController;
use App\Http\Controllers\Web\AuthController;
use App\Http\Controllers\Web\FavoriteParkingSpotController;
use Illuminate\Support\Facades\Route;

Route::get('/', MapController::class)->name('map');

Route::get('/account/session', [AuthController::class, 'session'])->name('account.session');
Route::post('/account/register', [AuthController::class, 'register'])->name('account.register');
Route::post('/account/login', [AuthController::class, 'login'])->name('account.login');
Route::post('/account/logout', [AuthController::class, 'logout'])->name('account.logout');

Route::middleware('auth')->group(function () {
    Route::get('/account/favorites', [FavoriteParkingSpotController::class, 'index'])->name('account.favorites');
    Route::post('/account/favorites/{parkingSpot}/toggle', [FavoriteParkingSpotController::class, 'toggle'])
        ->name('account.favorites.toggle');
});
