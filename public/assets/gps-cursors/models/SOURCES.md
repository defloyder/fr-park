3D GPS cursor models

Primary model:

- `toy-car.glb`

Source: Khronos glTF Sample Assets, Toy Car
License: CC0 1.0 / Public Domain
Repository: https://github.com/KhronosGroup/glTF-Sample-Assets
Original asset: https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/ToyCar/glTF-Binary/ToyCar.glb

Local processing:

- optimized with glTF Transform
- texture size capped at 512px
- texture encoding converted to WebP
- mesh simplified without meshopt geometry compression so the existing Three.js GLTFLoader can load it without an extra decoder

The same base model is recolored at runtime for black, red, white, cyan, and graphite GPS cursor variants.
