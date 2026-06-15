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
            ->assertJsonFragment(['detailType' => 'road_gore'])
            ->assertJsonFragment(['detailType' => 'parking_restriction', 'side' => 'right']);
    }

    public function test_road_detail_bounds_are_limited(): void
    {
        $this->getJson('/api/map/road-details?south=55&west=37&north=56&east=38')
            ->assertUnprocessable();
    }
}
