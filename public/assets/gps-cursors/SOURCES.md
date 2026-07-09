# GPS cursor assets

Vehicle cursor images are based on CC0 model renders from the Quaternius Cars Bundle on Poly Pizza:
https://poly.pizza/bundle/Cars-Bundle-FE5IWe6OMk

Poly Pizza lists the bundle as free for personal and commercial use, and the included car models as CC0 1.0.

Used source previews:

- Car, public id `Cz6yDaUcM9`: `quaternius-car-blue.webp`
- Sports Car, public id `1mkmFkAz5v`: `quaternius-sports-orange.webp`
- Sports Car, public id `OyqKvX9xNh`: `quaternius-sports-red.webp`
- SUV, public id `xsMtZhBkxL`: `quaternius-suv-green.webp`
- Taxi, public id `x43lOScTpN`: `quaternius-taxi.webp`
- Police Car, public id `BwwnUrWGmV`: `quaternius-police.webp`

MapLibre symbol layers use 2D images, so the app registers these model renders as canvas sprites and removes the Poly Pizza preview background at runtime.
