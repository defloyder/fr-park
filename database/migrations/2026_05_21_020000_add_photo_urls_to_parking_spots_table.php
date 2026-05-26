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
            $table->json('photo_urls')->nullable()->after('photo_url');
        });

        DB::table('parking_spots')
            ->whereNotNull('photo_url')
            ->whereNull('photo_urls')
            ->orderBy('id')
            ->chunkById(100, function ($spots) {
                foreach ($spots as $spot) {
                    DB::table('parking_spots')
                        ->where('id', $spot->id)
                        ->update(['photo_urls' => json_encode([$spot->photo_url])]);
                }
            });
    }

    public function down(): void
    {
        Schema::table('parking_spots', function (Blueprint $table) {
            $table->dropColumn('photo_urls');
        });
    }
};
