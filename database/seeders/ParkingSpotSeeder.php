<?php

namespace Database\Seeders;

use App\Models\ParkingSpot;
use Illuminate\Database\Seeder;

class ParkingSpotSeeder extends Seeder
{
    public function run(): void
    {
        $spots = [
            [
                'title' => 'Чистые пруды',
                'address' => 'Москва, Чистопрудный бульвар',
                'latitude' => 55.7649000,
                'longitude' => 37.6387000,
                'is_verified' => true,
                'availability_status' => 'verified',
                'photo_url' => 'https://images.unsplash.com/photo-1513326738677-b964603b136d?auto=format&fit=crop&w=1200&q=80',
                'access_instructions' => 'Заезд удобнее со стороны бульварного кольца. Перед остановкой проверьте знаки и разметку на конкретном участке.',
                'landmarks' => 'Ориентиры: бульвар, станция метро «Чистые пруды», пешеходные зоны рядом с прудом.',
                'parking_notes' => 'Тестовая точка для демонстрации. Не является юридическим подтверждением бесплатной парковки.',
            ],
            [
                'title' => 'Арбат',
                'address' => 'Москва, улица Арбат',
                'latitude' => 55.7522000,
                'longitude' => 37.5931000,
                'is_verified' => false,
                'availability_status' => 'temporary',
                'photo_url' => 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1200&q=80',
                'access_instructions' => 'Подъезд лучше планировать с соседних улиц, так как часть зоны пешеходная и движение ограничено.',
                'landmarks' => 'Ориентиры: Старый Арбат, переулки рядом с бульварным кольцом, плотный пешеходный поток.',
                'parking_notes' => 'Тестовая точка. Нужна проверка на месте перед использованием.',
            ],
            [
                'title' => 'Патриаршие пруды',
                'address' => 'Москва, район Патриарших прудов',
                'latitude' => 55.7636000,
                'longitude' => 37.5922000,
                'is_verified' => true,
                'availability_status' => 'verified',
                'photo_url' => 'https://images.unsplash.com/photo-1520106212299-d99c443e4568?auto=format&fit=crop&w=1200&q=80',
                'access_instructions' => 'Заезд возможен через Малую Бронную или соседние переулки. Вечером район загружен сильнее.',
                'landmarks' => 'Ориентиры: пруд, Малая Бронная, тихие переулки внутри Садового кольца.',
                'parking_notes' => 'Тестовая точка для демонстрации. Проверяйте актуальные знаки.',
            ],
            [
                'title' => 'Тверская зона',
                'address' => 'Москва, Тверская улица',
                'latitude' => 55.7616000,
                'longitude' => 37.6095000,
                'is_verified' => false,
                'availability_status' => 'outdated',
                'photo_url' => 'https://images.unsplash.com/photo-1523731407965-2430cd12f5e4?auto=format&fit=crop&w=1200&q=80',
                'access_instructions' => 'Лучше подъезжать через боковые улицы, не пытаясь останавливаться на основной магистрали.',
                'landmarks' => 'Ориентиры: Тверская, Пушкинская площадь, боковые проезды и переулки.',
                'parking_notes' => 'Тестовая точка. Требует проверки доступности и правил остановки.',
            ],
            [
                'title' => 'Красные Ворота',
                'address' => 'Москва, площадь Красные Ворота',
                'latitude' => 55.7697000,
                'longitude' => 37.6492000,
                'is_verified' => true,
                'availability_status' => 'verified',
                'photo_url' => 'https://images.unsplash.com/photo-1547448415-e9f5b28e570d?auto=format&fit=crop&w=1200&q=80',
                'access_instructions' => 'Подъезд удобнее со стороны Садового кольца, но развороты и полосность лучше смотреть заранее.',
                'landmarks' => 'Ориентиры: метро «Красные Ворота», высотка, Садовое кольцо.',
                'parking_notes' => 'Тестовая точка для демонстрации, проверяйте знаки на месте.',
            ],
            [
                'title' => 'Китай-город',
                'address' => 'Москва, район Китай-город',
                'latitude' => 55.7547000,
                'longitude' => 37.6338000,
                'is_verified' => false,
                'availability_status' => 'unverified',
                'photo_url' => 'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=1200&q=80',
                'access_instructions' => 'Двигайтесь через набережные или боковые улицы, в часы пик район быстро заполняется.',
                'landmarks' => 'Ориентиры: Китай-город, Зарядье, Варварка, Старосадский переулок.',
                'parking_notes' => 'Тестовая точка. Нужна ручная проверка актуальности.',
            ],
            [
                'title' => 'Цветной бульвар',
                'address' => 'Москва, Цветной бульвар',
                'latitude' => 55.7719000,
                'longitude' => 37.6208000,
                'is_verified' => true,
                'availability_status' => 'verified',
                'photo_url' => 'https://images.unsplash.com/photo-1560969184-10fe8719e047?auto=format&fit=crop&w=1200&q=80',
                'access_instructions' => 'Заезд проще со стороны бульвара и соседних переулков. Учитывайте плотный трафик вечером.',
                'landmarks' => 'Ориентиры: Цветной бульвар, цирк Никулина, метро «Цветной бульвар».',
                'parking_notes' => 'Тестовая точка для прототипа. Перед парковкой проверяйте дорожные знаки.',
            ],
        ];

        foreach ($spots as $spot) {
            ParkingSpot::updateOrCreate(
                ['title' => $spot['title']],
                [
                    ...$spot,
                    'description' => 'Демонстрационная точка Auralith Maps с примером подробного описания места, заезда и ориентиров.',
                    'status' => 'active',
                    'source' => 'manual',
                ]
            );
        }
    }
}
