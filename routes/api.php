<?php

use App\Http\Controllers\Api\GeocodeController;
use App\Http\Controllers\Api\ParkingSpotController;
use App\Http\Controllers\Api\RoadDetailController;
use App\Http\Controllers\Api\RouteController;
use App\Http\Controllers\Api\SessionController;
use App\Http\Controllers\Api\SpeedCameraController;
use App\Http\Middleware\EncryptApiResponse;
use App\Http\Middleware\ValidateApiToken;
use Illuminate\Support\Facades\Route;

// Выдаёт одноразовый токен и AES-ключ — требуется перед любым обращением к /parking-spots
Route::post('session/init', [SessionController::class, 'init'])
    ->middleware('throttle:30,1')
    ->name('session.init');

Route::get('geocode/reverse', [GeocodeController::class, 'reverse'])
    ->name('geocode.reverse');

Route::get('routes/driving', [RouteController::class, 'driving'])
    ->middleware('throttle:60,1')
    ->name('routes.driving');

Route::get('map/road-details', RoadDetailController::class)
    ->middleware('throttle:30,1')
    ->name('map.road-details');

Route::post('navigation/speed-cameras', SpeedCameraController::class)
    ->middleware('throttle:30,1')
    ->name('navigation.speed-cameras');

Route::middleware(['web', 'admin'])->group(function (): void {
    Route::post('parking-spots/import', [ParkingSpotController::class, 'import'])
        ->name('parking-spots.import');

    Route::get('parking-spots/export', [ParkingSpotController::class, 'export'])
        ->name('parking-spots.export');

    Route::patch('parking-spots/{parkingSpot}', [ParkingSpotController::class, 'update'])
        ->name('parking-spots.update');

    Route::delete('parking-spots/{parkingSpot}', [ParkingSpotController::class, 'destroy'])
        ->name('parking-spots.destroy');
});

Route::middleware(['web', 'auth'])->group(function (): void {
    Route::post('parking-spots', [ParkingSpotController::class, 'store'])
        ->name('parking-spots.store');

    Route::post('parking-spots/photo', [ParkingSpotController::class, 'uploadPhoto'])
        ->name('parking-spots.photo');
});

// Публичное чтение — требует валидный токен сессии, ответ шифруется AES-256-GCM
Route::middleware([ValidateApiToken::class, EncryptApiResponse::class])
    ->group(function (): void {
        Route::get('parking-spots', [ParkingSpotController::class, 'index'])
            ->name('parking-spots.index');

        Route::get('parking-spots/{parkingSpot}', [ParkingSpotController::class, 'show'])
            ->name('parking-spots.show');
    });
