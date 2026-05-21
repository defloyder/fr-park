<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('parking_spots', function (Blueprint $table) {
            $table->enum('availability_status', ['unverified', 'verified', 'temporary', 'outdated'])
                ->default('unverified')
                ->after('is_verified');

            $table->index('availability_status');
        });

        DB::table('parking_spots')
            ->where('is_verified', true)
            ->update(['availability_status' => 'verified']);
    }

    public function down(): void
    {
        Schema::table('parking_spots', function (Blueprint $table) {
            $table->dropIndex(['availability_status']);
            $table->dropColumn('availability_status');
        });
    }
};
