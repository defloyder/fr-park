<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreParkingSpotRequest;
use App\Http\Requests\UpdateParkingSpotRequest;
use App\Http\Resources\ParkingSpotResource;
use App\Models\ParkingSpot;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ParkingSpotController extends Controller
{
    public function index(): AnonymousResourceCollection
    {
        $spots = ParkingSpot::query()
            ->whereIn('status', ['active', 'pending'])
            ->latest('is_verified')
            ->latest()
            ->get();

        return ParkingSpotResource::collection($spots);
    }

    public function store(StoreParkingSpotRequest $request): ParkingSpotResource
    {
        $spot = ParkingSpot::create([
            ...$request->validated(),
            'status' => 'pending',
            'source' => 'user',
            'is_verified' => $request->validated('availability_status') === 'verified',
        ]);

        return ParkingSpotResource::make($spot);
    }

    public function show(ParkingSpot $parkingSpot): ParkingSpotResource
    {
        abort_if($parkingSpot->status === 'hidden', 404);

        return ParkingSpotResource::make($parkingSpot);
    }

    public function update(UpdateParkingSpotRequest $request, ParkingSpot $parkingSpot): ParkingSpotResource
    {
        $validated = $request->validated();

        if (array_key_exists('availability_status', $validated)) {
            $validated['is_verified'] = $validated['availability_status'] === 'verified';
        }

        $parkingSpot->update($validated);

        return ParkingSpotResource::make($parkingSpot->refresh());
    }

    public function destroy(ParkingSpot $parkingSpot): Response
    {
        $parkingSpot->update(['status' => 'hidden']);

        return response()->noContent();
    }

    public function uploadPhoto(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'photo' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,heic,heif', 'max:20480'],
        ]);

        $path = $validated['photo']->store('parking-spots', 'public');

        return response()->json([
            'url' => url('/storage/'.$path),
        ]);
    }

    public function export(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => ['nullable', 'string', 'max:2000'],
        ]);

        $ids = collect(explode(',', $validated['ids'] ?? ''))
            ->map(fn ($id) => (int) trim($id))
            ->filter()
            ->unique()
            ->values();

        $spots = ParkingSpot::query()
            ->whereIn('status', ['active', 'pending'])
            ->when($ids->isNotEmpty(), fn ($query) => $query->whereIn('id', $ids))
            ->orderBy('id')
            ->get();

        return response()
            ->json([
                'exported_at' => now()->toISOString(),
                'app' => 'Auralith Maps',
                'version' => 1,
                'count' => $spots->count(),
                'data' => $spots->map(fn (ParkingSpot $spot) => $this->formatSpotForExport($spot))->values(),
            ], 200, [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)
            ->header('Content-Disposition', 'attachment; filename="auralith-maps-spots-'.now()->format('Y-m-d-H-i-s').'.json"');
    }

    public function import(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'json_file' => ['nullable', 'file', 'mimes:json,txt', 'max:10240'],
            'json_text' => ['nullable', 'string', 'max:200000'],
        ]);

        $raw = $request->hasFile('json_file')
            ? $request->file('json_file')->get()
            : ($validated['json_text'] ?? '');

        if (! is_string($raw) || trim($raw) === '') {
            throw ValidationException::withMessages([
                'json_text' => 'Загрузите JSON-файл или вставьте JSON-текст.',
            ]);
        }

        $items = $this->decodeImportPayload($raw);
        $created = collect();
        $skipped = [];
        $errors = [];

        foreach ($items as $index => $item) {
            if (! is_array($item)) {
                $errors[] = [
                    'row' => $index + 1,
                    'message' => 'Элемент должен быть объектом.',
                ];
                continue;
            }

            $payload = $this->normalizeImportedSpot($item);
            $validator = Validator::make($payload, [
                'title' => ['required', 'string', 'max:255'],
                'address' => ['nullable', 'string', 'max:500'],
                'latitude' => ['required', 'numeric', 'between:-90,90'],
                'longitude' => ['required', 'numeric', 'between:-180,180'],
                'description' => ['nullable', 'string', 'max:2000'],
                'photo_url' => ['nullable', 'string', 'max:1000'],
                'photo_urls' => ['nullable', 'array', 'max:12'],
                'photo_urls.*' => ['string', 'max:1000'],
                'access_instructions' => ['nullable', 'string', 'max:2000'],
                'landmarks' => ['nullable', 'string', 'max:2000'],
                'parking_notes' => ['nullable', 'string', 'max:2000'],
            ]);

            if ($validator->fails()) {
                $errors[] = [
                    'row' => $index + 1,
                    'message' => $validator->errors()->first(),
                ];
                continue;
            }

            $data = $validator->validated();
            $exists = ParkingSpot::query()
                ->where('title', $data['title'])
                ->where('latitude', $data['latitude'])
                ->where('longitude', $data['longitude'])
                ->exists();

            if ($exists) {
                $skipped[] = [
                    'row' => $index + 1,
                    'title' => $data['title'],
                    'reason' => 'duplicate',
                ];
                continue;
            }

            $created->push(ParkingSpot::create([
                ...$data,
                'status' => $payload['status'] ?? 'active',
                'source' => 'imported',
                'availability_status' => $payload['availability_status'] ?? 'unverified',
                'is_verified' => ($payload['availability_status'] ?? null) === 'verified',
            ]));
        }

        return response()->json([
            'created_count' => $created->count(),
            'skipped_count' => count($skipped),
            'error_count' => count($errors),
            'skipped' => $skipped,
            'errors' => $errors,
            'data' => ParkingSpotResource::collection($created)->resolve(),
        ]);
    }

    private function decodeImportPayload(string $raw): array
    {
        $decoded = json_decode($raw, true);

        if (! is_array($decoded)) {
            $decoded = json_decode($this->normalizePythonLikeJson($raw), true);
        }

        if (! is_array($decoded)) {
            throw ValidationException::withMessages([
                'json_text' => 'Не удалось прочитать JSON. Проверьте формат файла.',
            ]);
        }

        if (Arr::isAssoc($decoded)) {
            $decoded = data_get($decoded, 'data', [$decoded]);
        }

        return is_array($decoded) ? $decoded : [];
    }

    private function normalizePythonLikeJson(string $raw): string
    {
        $normalized = preg_replace('/\bNone\b/', 'null', $raw) ?? $raw;
        $normalized = preg_replace('/\bTrue\b/', 'true', $normalized) ?? $normalized;
        $normalized = preg_replace('/\bFalse\b/', 'false', $normalized) ?? $normalized;

        return str_replace("'", '"', $normalized);
    }

    private function normalizeImportedSpot(array $item): array
    {
        $title = trim((string) ($item['name'] ?? $item['title'] ?? ''));
        $address = trim((string) ($item['address_text'] ?? $item['address'] ?? ''));
        $latitude = $item['lat'] ?? $item['latitude'] ?? null;
        $longitude = $item['lng'] ?? $item['longitude'] ?? null;
        $photos = collect($item['photos'] ?? $item['photo_urls'] ?? [])
            ->filter(fn ($photo) => is_string($photo) && trim($photo) !== '')
            ->map(fn ($photo) => $this->normalizeImportedPhotoPath($photo))
            ->values()
            ->take(12)
            ->all();

        return [
            'title' => $title !== '' ? $title : 'Импортированная парковка',
            'address' => $address !== '' ? $address : $title,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'description' => trim((string) ($item['description'] ?? '')),
            'photo_url' => $photos[0] ?? null,
            'photo_urls' => $photos,
            'access_instructions' => trim((string) ($item['access_instructions'] ?? '')),
            'landmarks' => trim((string) ($item['landmarks'] ?? '')),
            'parking_notes' => trim((string) ($item['parking_notes'] ?? '')),
            'status' => in_array(($item['status'] ?? null), ['active', 'pending'], true) ? $item['status'] : 'active',
            'availability_status' => in_array(($item['availability_status'] ?? null), ['verified', 'unverified', 'temporary', 'outdated'], true)
                ? $item['availability_status']
                : 'unverified',
        ];
    }

    private function normalizeImportedPhotoPath(string $photo): string
    {
        $photo = trim($photo);

        if (Str::startsWith($photo, ['http://', 'https://', '/'])) {
            return $photo;
        }

        return '/storage/'.ltrim($photo, '/');
    }

    private function formatSpotForExport(ParkingSpot $spot): array
    {
        $photos = collect($spot->photo_urls ?? [])
            ->filter()
            ->values();

        if ($photos->isEmpty() && $spot->photo_url) {
            $photos = collect([$spot->photo_url]);
        }

        return [
            'id' => $spot->id,
            'title' => $spot->title,
            'name' => $spot->title,
            'address' => $spot->address,
            'address_text' => $spot->address,
            'latitude' => (float) $spot->latitude,
            'longitude' => (float) $spot->longitude,
            'lat' => (float) $spot->latitude,
            'lng' => (float) $spot->longitude,
            'description' => $spot->description,
            'photo_url' => $this->normalizePhotoUrl($spot->photo_url, request()),
            'photo_urls' => $photos->map(fn (string $photo) => $this->normalizePhotoUrl($photo, request()))->filter()->values()->all(),
            'photos' => $photos->map(fn (string $photo) => $this->normalizePhotoUrl($photo, request()))->filter()->values()->all(),
            'access_instructions' => $spot->access_instructions,
            'landmarks' => $spot->landmarks,
            'parking_notes' => $spot->parking_notes,
            'status' => $spot->status,
            'source' => $spot->source,
            'is_verified' => (bool) $spot->is_verified,
            'availability_status' => $spot->availability_status,
            'created_at' => $spot->created_at?->toISOString(),
            'updated_at' => $spot->updated_at?->toISOString(),
        ];
    }

    private function normalizePhotoUrl(?string $photo, Request $request): ?string
    {
        if (! $photo) {
            return null;
        }

        $photo = trim($photo);

        if (Str::startsWith($photo, ['http://', 'https://'])) {
            $parts = parse_url($photo);
            $appIp = config('app.ip');
            $appDomain = config('app.domain');
            $host = $parts['host'] ?? null;
            $path = $parts['path'] ?? '';

            if ($host && in_array($host, array_filter([$appIp, $appDomain, $request->getHost()]), true)) {
                $query = isset($parts['query']) ? '?'.$parts['query'] : '';

                return $request->getSchemeAndHttpHost().$path.$query;
            }

            return $photo;
        }

        return $request->getSchemeAndHttpHost().'/'.ltrim($photo, '/');
    }
}
