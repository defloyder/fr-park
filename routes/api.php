<?php

use App\Http\Controllers\Api\ParkingSpotController;
use Illuminate\Support\Facades\Route;

Route::post('parking-spots/photo', [ParkingSpotController::class, 'uploadPhoto'])
    ->name('parking-spots.photo');

Route::apiResource('parking-spots', ParkingSpotController::class)
    ->parameters(['parking-spots' => 'parkingSpot']);
