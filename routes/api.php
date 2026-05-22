<?php

use App\Http\Controllers\Api\ParkingSpotController;
use App\Http\Controllers\Api\GeocodeController;
use Illuminate\Support\Facades\Route;

Route::get('geocode/reverse', [GeocodeController::class, 'reverse'])
    ->name('geocode.reverse');

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

Route::get('parking-spots', [ParkingSpotController::class, 'index'])
    ->name('parking-spots.index');

Route::get('parking-spots/{parkingSpot}', [ParkingSpotController::class, 'show'])
    ->name('parking-spots.show');
