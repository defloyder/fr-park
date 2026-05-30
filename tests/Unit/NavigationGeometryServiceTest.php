<?php

namespace Tests\Unit;

use App\Services\NavigationGeometryService;
use PHPUnit\Framework\TestCase;

class NavigationGeometryServiceTest extends TestCase
{
    public function test_it_projects_point_to_route_progress(): void
    {
        $geometry = new NavigationGeometryService();
        $route = [
            [37.0, 55.0],
            [37.01, 55.0],
            [37.02, 55.0],
        ];

        $point = [
            'longitude' => 37.015,
            'latitude' => 55.0002,
        ];

        $closest = $geometry->closestRoutePoint($route, $point);

        $this->assertLessThan(30, $closest['distanceMeters']);
        $this->assertGreaterThan(900, $closest['progressMeters']);
        $this->assertLessThan(1000, $closest['progressMeters']);
    }

    public function test_it_calculates_wrapped_angle_difference(): void
    {
        $geometry = new NavigationGeometryService();

        $this->assertSame(20.0, $geometry->angleDifference(350, 10));
        $this->assertSame(45.0, $geometry->angleDifference(90, 45));
    }
}
