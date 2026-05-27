<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\View\View;

class MapController extends Controller
{
    public function __invoke(Request $request): View
    {
        return view('pages.map', [
            'isEmbed' => $request->boolean('embed'),
            'tomtomTrafficKey' => config('services.tomtom_traffic.key'),
        ]);
    }
}
