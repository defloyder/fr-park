<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('parking_spots', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->string('address')->nullable();
            $table->decimal('latitude', 10, 7);
            $table->decimal('longitude', 10, 7);
            $table->text('description')->nullable();
            $table->enum('status', ['active', 'hidden', 'pending'])->default('active');
            $table->enum('source', ['manual', 'user', 'imported'])->default('manual');
            $table->boolean('is_verified')->default(false);
            $table->timestamps();

            $table->index(['latitude', 'longitude']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('parking_spots');
    }
};
