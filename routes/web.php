<?php

use App\Http\Controllers\Web\MapController;
use Illuminate\Support\Facades\Route;

Route::get('/', MapController::class)->name('map');
