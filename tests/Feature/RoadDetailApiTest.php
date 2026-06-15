<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class RoadDetailApiTest extends TestCase
{
    public function test_road_details_return_real_osm_markings(): void
    {
        Cache::flush();
        Http::fake([
            'overpass-api.de/*' => Http::response([
                'elements' => [
                    [
                        'type' => 'node',
                        'id' => 10,
                        'lat' => 55.75,
                        'lon' => 37.61,
                        'tags' => ['highway' => 'crossing'],
                    ],
                    [
                        'type' => 'node',
                        'id' => 11,
                        'lat' => 55.751,
                        'lon' => 37.611,
                        'tags' => ['traffic_calming' => 'table'],
                    ],
                    [
                        'type' => 'way',
                        'id' => 20,
                        'nodes' => [10, 11],
                        'geometry' => [
                            ['lat' => 55.75, 'lon' => 37.61],
                            ['lat' => 55.751, 'lon' => 37.611],
                        ],
                        'tags' => [
                            'highway' => 'primary',
                            'lanes' => '3',
                            'lanes:forward' => '2',
                            'lanes:backward' => '1',
                            'name' => 'Test avenue',
                            'maxspeed' => '60',
                            'parking:condition:right' => 'no_stopping',
                            'turn:lanes' => 'left|through|through;right',
                        ],
                    ],
                    [
                        'type' => 'way',
                        'id' => 21,
                        'nodes' => [10, 12],
                        'geometry' => [
                            ['lat' => 55.75, 'lon' => 37.61],
                            ['lat' => 55.7507, 'lon' => 37.6115],
                        ],
                        'tags' => [
                            'highway' => 'primary_link',
                            'lanes' => '2',
                            'oneway' => 'yes',
                        ],
                    ],
                    [
                        'type' => 'way',
                        'id' => 22,
                        'nodes' => [10, 13],
                        'geometry' => [
                            ['lat' => 55.75, 'lon' => 37.61],
                            ['lat' => 55.75, 'lon' => 37.6085],
                        ],
                        'tags' => [
                            'highway' => 'primary',
                            'lanes' => '3',
                            'oneway' => 'yes',
                        ],
                    ],
                    [
                        'type' => 'way',
                        'id' => 23,
                        'nodes' => [14, 15],
                        'geometry' => [
                            ['lat' => 55.752, 'lon' => 37.612],
                            ['lat' => 55.753, 'lon' => 37.613],
                        ],
                        'tags' => [
                            'highway' => 'motorway',
                            'name' => 'MKAD',
                            'maxspeed' => '100',
                        ],
                    ],
                    [
                        'type' => 'way',
                        'id' => 24,
                        'nodes' => [30, 31, 32],
                        'geometry' => [
                            ['lat' => 55.754, 'lon' => 37.610],
                            ['lat' => 55.755, 'lon' => 37.611],
                            ['lat' => 55.756, 'lon' => 37.612],
                        ],
                        'tags' => [
                            'highway' => 'motorway',
                            'lanes' => '4',
                            'oneway' => 'yes',
                        ],
                    ],
                    [
                        'type' => 'way',
                        'id' => 25,
                        'nodes' => [31, 33, 34],
                        'geometry' => [
                            ['lat' => 55.755, 'lon' => 37.611],
                            ['lat' => 55.7556, 'lon' => 37.6123],
                            ['lat' => 55.7560, 'lon' => 37.6135],
                        ],
                        'tags' => [
                            'highway' => 'motorway_link',
                            'lanes' => '1',
                            'oneway' => 'yes',
                        ],
                    ],
                ],
            ]),
        ]);

        $response = $this->getJson('/api/map/road-details?south=55.74&west=37.60&north=55.76&east=37.62');

        $response->assertOk()
            ->assertJsonPath('type', 'FeatureCollection')
            ->assertJsonFragment(['detailType' => 'crossing'])
            ->assertJsonFragment(['detailType' => 'speed_bump'])
            ->assertJsonFragment(['detailType' => 'maxspeed', 'maxspeed' => '60'])
            ->assertJsonFragment([
                'detailType' => 'road_geometry',
                'roadClass' => 'primary',
                'laneCount' => 3,
                'directionBoundary' => 1,
                'name' => 'Test avenue',
            ])
            ->assertJsonFragment(['detailType' => 'turn_lanes'])
            ->assertJsonFragment(['turnLanes' => [['left'], ['through'], ['through', 'right']]])
            ->assertJsonFragment(['detailType' => 'turn_lanes', 'inferred' => true])
            ->assertJsonFragment(['detailType' => 'road_gore'])
            ->assertJsonFragment(['detailType' => 'parking_restriction', 'side' => 'right'])
            ->assertJsonFragment([
                'detailType' => 'road_geometry',
                'roadClass' => 'motorway',
                'laneCount' => 4,
                'name' => 'MKAD',
            ]);
    }

    public function test_road_detail_bounds_are_limited(): void
    {
        $this->getJson('/api/map/road-details?south=55&west=37&north=56&east=38')
            ->assertUnprocessable();
    }

    public function test_overpass_failure_returns_an_available_geojson_response(): void
    {
        Cache::flush();
        Http::fake(fn () => Http::failedConnection());

        $this->getJson('/api/map/road-details?south=55.74&west=37.60&north=55.76&east=37.62')
            ->assertOk()
            ->assertJsonPath('type', 'FeatureCollection')
            ->assertJsonPath('features', [])
            ->assertJsonPath('unavailable', true);
    }
}
