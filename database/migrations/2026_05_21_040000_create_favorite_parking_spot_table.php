<?php

use App\Models\ParkingSpot;
use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('favorite_parking_spot', function (Blueprint $table) {
            $table->id();
            $table->foreignIdFor(User::class)->constrained()->cascadeOnDelete();
            $table->foreignIdFor(ParkingSpot::class)->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['user_id', 'parking_spot_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('favorite_parking_spot');
    }
};
