<?php

use App\Http\Controllers\Web\MapController;
use App\Http\Controllers\Web\AdminController;
use App\Http\Controllers\Web\AuthController;
use App\Http\Controllers\Web\FavoriteParkingSpotController;
use App\Http\Controllers\Web\PersonalPlaceController;
use Illuminate\Support\Facades\Route;

Route::get('/', MapController::class)->name('map');

Route::middleware('admin')->prefix('aura-vault-7f3c')->name('admin.')->group(function (): void {
    Route::get('/', [AdminController::class, 'index'])->name('index');
    Route::get('/spots', [AdminController::class, 'spots'])->name('spots');
    Route::post('/spots/bulk', [AdminController::class, 'bulk'])->name('spots.bulk');
    Route::get('/users', [AdminController::class, 'users'])->name('users');
    Route::get('/metrics', [AdminController::class, 'metrics'])->name('metrics');
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
    Route::get('/account/personal-places', [PersonalPlaceController::class, 'index'])
        ->name('account.personal-places.index');
    Route::post('/account/personal-places', [PersonalPlaceController::class, 'store'])
        ->name('account.personal-places.store');
    Route::post('/account/personal-places/sync', [PersonalPlaceController::class, 'sync'])
        ->name('account.personal-places.sync');
    Route::delete('/account/personal-places/{personalPlace}', [PersonalPlaceController::class, 'destroy'])
        ->name('account.personal-places.destroy');
});
