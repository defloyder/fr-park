<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;
use Throwable;

class ServiceMetricsService
{
    private const PREFIX = 'service:metrics';

    private const MAP_REASONS = [
        'map_slow_boot',
        'map_stuck_boot',
        'map_ready_slow',
        'map_tile_failures',
        'maplibre_error',
        'map_init_failed',
        'map_layers_failed',
        'parking_load_failed',
        'fuel_request_slow',
        'fuel_request_failed',
        'webgl_unsupported',
    ];

    public function recordMapDiagnostic(array $payload): void
    {
        $reason = $this->normalizeReason((string) ($payload['reason'] ?? 'unknown'));
        $minute = now()->utc()->format('YmdHi');
        $ttl = now()->addDays(3);

        $this->increment("map:minute:{$minute}:total", $ttl);
        $this->increment("map:minute:{$minute}:reason:{$reason}", $ttl);
        $this->increment('map:total', now()->addDays(30));
        $this->increment("map:reason:{$reason}:total", now()->addDays(30));

        $tileFailures = (int) data_get($payload, 'counters.tileFailures', 0);
        if ($tileFailures > 0) {
            $this->increment("map:minute:{$minute}:tile_failures_observed", $ttl, $tileFailures);
        }

        $mapReadyMs = (int) data_get($payload, 'timings.mapReady', 0);
        if ($mapReadyMs > 0) {
            $this->increment("map:minute:{$minute}:map_ready_sum_ms", $ttl, $mapReadyMs);
            $this->increment("map:minute:{$minute}:map_ready_count", $ttl);
        }

        $fuelTotalMs = (int) data_get($payload, 'details.lastFuelTotalMs', data_get($payload, 'details.fuelTotalMs', 0));
        if ($fuelTotalMs > 0) {
            $this->increment("map:minute:{$minute}:fuel_sum_ms", $ttl, $fuelTotalMs);
            $this->increment("map:minute:{$minute}:fuel_count", $ttl);
        }

        $this->rememberLatestEvent($payload, $reason);
    }

    public function snapshot(): array
    {
        $lastHour = $this->windowSummary(60);
        $lastDay = $this->windowSummary(24 * 60);

        return [
            'generated_at' => now()->toISOString(),
            'cache' => [
                'default_store' => (string) config('cache.default'),
                'session_driver' => (string) config('session.driver'),
                'queue_connection' => (string) config('queue.default'),
                'redis' => $this->redisStatus(),
            ],
            'map' => [
                'last_hour' => $lastHour,
                'last_day' => $lastDay,
                'total' => (int) $this->cacheGet($this->key('map:total'), 0),
                'latest' => array_values((array) $this->cacheGet($this->key('map:latest'), [])),
            ],
        ];
    }

    private function windowSummary(int $minutes): array
    {
        $total = 0;
        $tileFailuresObserved = 0;
        $mapReadySum = 0;
        $mapReadyCount = 0;
        $fuelSum = 0;
        $fuelCount = 0;
        $reasons = array_fill_keys(self::MAP_REASONS, 0);
        $metricKeys = [
            'total' => [],
            'tile_failures_observed' => [],
            'map_ready_sum_ms' => [],
            'map_ready_count' => [],
            'fuel_sum_ms' => [],
            'fuel_count' => [],
        ];
        $reasonKeys = [];

        foreach ($this->minuteKeys($minutes) as $minute) {
            foreach ($metricKeys as $metric => $keys) {
                $metricKeys[$metric][] = $this->key("map:minute:{$minute}:{$metric}");
            }

            foreach (self::MAP_REASONS as $reason) {
                $reasonKeys[$reason][] = $this->key("map:minute:{$minute}:reason:{$reason}");
            }
        }

        $values = $this->cacheMany(array_merge(
            ...array_values($metricKeys),
            ...array_values($reasonKeys),
        ));

        foreach ($metricKeys['total'] as $key) {
            $total += (int) ($values[$key] ?? 0);
        }

        foreach ($metricKeys['tile_failures_observed'] as $key) {
            $tileFailuresObserved += (int) ($values[$key] ?? 0);
        }

        foreach ($metricKeys['map_ready_sum_ms'] as $key) {
            $mapReadySum += (int) ($values[$key] ?? 0);
        }

        foreach ($metricKeys['map_ready_count'] as $key) {
            $mapReadyCount += (int) ($values[$key] ?? 0);
        }

        foreach ($metricKeys['fuel_sum_ms'] as $key) {
            $fuelSum += (int) ($values[$key] ?? 0);
        }

        foreach ($metricKeys['fuel_count'] as $key) {
            $fuelCount += (int) ($values[$key] ?? 0);
        }

        foreach ($reasonKeys as $reason => $keys) {
            foreach ($keys as $key) {
                $reasons[$reason] += (int) ($values[$key] ?? 0);
            }
        }

        return [
            'events' => $total,
            'tile_failures_observed' => $tileFailuresObserved,
            'avg_map_ready_ms' => $mapReadyCount > 0 ? (int) round($mapReadySum / $mapReadyCount) : null,
            'avg_fuel_request_ms' => $fuelCount > 0 ? (int) round($fuelSum / $fuelCount) : null,
            'reasons' => array_filter($reasons, fn (int $count): bool => $count > 0),
        ];
    }

    private function rememberLatestEvent(array $payload, string $reason): void
    {
        $event = [
            'at' => now()->toISOString(),
            'reason' => $reason,
            'page' => (string) ($payload['page'] ?? ''),
            'map_ready_ms' => data_get($payload, 'timings.mapReady'),
            'tile_failures' => data_get($payload, 'counters.tileFailures'),
            'fuel_total_ms' => data_get($payload, 'details.lastFuelTotalMs', data_get($payload, 'details.fuelTotalMs')),
            'viewport' => data_get($payload, 'device.viewport'),
            'connection' => data_get($payload, 'device.connection.effectiveType'),
            'user_agent' => mb_substr((string) data_get($payload, 'device.userAgent', ''), 0, 180),
        ];

        try {
            $lock = Cache::lock($this->key('map:latest:lock'), 3);
            $lock->block(1);
        } catch (Throwable) {
            $lock = null;
        }

        try {
            $latest = (array) $this->cacheGet($this->key('map:latest'), []);
            array_unshift($latest, $event);
            Cache::put($this->key('map:latest'), array_slice($latest, 0, 25), now()->addDays(7));
        } catch (Throwable) {
        } finally {
            try {
                $lock?->release();
            } catch (Throwable) {
            }
        }
    }

    private function redisStatus(): array
    {
        try {
            $startedAt = microtime(true);
            $pong = Redis::connection()->ping();

            return [
                'available' => true,
                'latency_ms' => (int) round((microtime(true) - $startedAt) * 1000),
                'response' => is_string($pong) ? $pong : 'ok',
            ];
        } catch (Throwable $exception) {
            return [
                'available' => false,
                'error' => mb_substr($exception->getMessage(), 0, 180),
            ];
        }
    }

    private function minuteKeys(int $minutes): array
    {
        $keys = [];
        $cursor = now()->utc()->startOfMinute();

        for ($index = 0; $index < $minutes; $index++) {
            $keys[] = $cursor->copy()->subMinutes($index)->format('YmdHi');
        }

        return $keys;
    }

    private function increment(string $key, \DateTimeInterface $ttl, int $amount = 1): void
    {
        try {
            $cacheKey = $this->key($key);
            Cache::add($cacheKey, 0, $ttl);
            Cache::increment($cacheKey, $amount);
        } catch (Throwable) {
        }
    }

    private function cacheGet(string $key, mixed $default = null): mixed
    {
        try {
            return Cache::get($key, $default);
        } catch (Throwable) {
            return $default;
        }
    }

    /**
     * Read counters in one cache call so an unavailable Redis does not multiply failures.
     *
     * @param  array<int, string>  $keys
     * @return array<string, mixed>
     */
    private function cacheMany(array $keys): array
    {
        if ($keys === []) {
            return [];
        }

        try {
            return Cache::many(array_values(array_unique($keys)));
        } catch (Throwable) {
            return [];
        }
    }

    private function key(string $key): string
    {
        return self::PREFIX.':'.$key;
    }

    private function normalizeReason(string $reason): string
    {
        $reason = preg_replace('/[^a-z0-9_:-]+/i', '_', trim($reason)) ?: 'unknown';

        return mb_substr($reason, 0, 80);
    }
}
