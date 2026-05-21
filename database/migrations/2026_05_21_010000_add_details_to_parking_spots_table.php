<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('parking_spots', function (Blueprint $table) {
            $table->string('photo_url')->nullable()->after('description');
            $table->text('access_instructions')->nullable()->after('photo_url');
            $table->text('landmarks')->nullable()->after('access_instructions');
            $table->text('parking_notes')->nullable()->after('landmarks');
        });
    }

    public function down(): void
    {
        Schema::table('parking_spots', function (Blueprint $table) {
            $table->dropColumn([
                'photo_url',
                'access_instructions',
                'landmarks',
                'parking_notes',
            ]);
        });
    }
};
