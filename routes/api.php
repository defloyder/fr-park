<?php

use App\Http\Controllers\Api\ParkingSpotController;
use App\Http\Controllers\Api\GeocodeController;
use Illuminate\Support\Facades\Route;

Route::get('geocode/reverse', [GeocodeController::class, 'reverse'])
    ->name('geocode.reverse');

Route::post('parking-spots/photo', [ParkingSpotController::class, 'uploadPhoto'])
    ->name('parking-spots.photo');

Route::middleware(['web', 'admin'])->group(function (): void {
    Route::post('parking-spots/import', [ParkingSpotController::class, 'import'])
        ->name('parking-spots.import');

    Route::get('parking-spots/export', [ParkingSpotController::class, 'export'])
        ->name('parking-spots.export');
});

Route::apiResource('parking-spots', ParkingSpotController::class)
    ->parameters(['parking-spots' => 'parkingSpot']);
