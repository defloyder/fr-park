<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
        'is_admin',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_admin' => 'boolean',
        ];
    }

    public function favoriteParkingSpots(): BelongsToMany
    {
        return $this->belongsToMany(ParkingSpot::class, 'favorite_parking_spot')
            ->withTimestamps();
    }

    public function isAdmin(): bool
    {
        if ((bool) $this->is_admin) {
            return true;
        }

        $adminEmail = config('auralith.admin_email');

        if (! is_string($adminEmail)) {
            return false;
        }

        $adminEmail = trim($adminEmail);
        $userEmail = trim((string) $this->email);

        return $adminEmail !== '' && strcasecmp($userEmail, $adminEmail) === 0;
    }
}
