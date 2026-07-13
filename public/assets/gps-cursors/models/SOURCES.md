3D GPS cursor models

The navigation cursor loads optimized GLB models from `runtime/`.
Original local source GLB files are kept in `source/`.

Current runtime bindings:

- `auralith-nav-black`: `runtime/bmw_m3_coupe_e30_1986.glb`
- `auralith-nav-red`: `runtime/lamborghini_aventador_lp700.glb`
- `auralith-nav-white`: `runtime/xyz_school_coursework_highpoly_porsche_singer.glb`
- `auralith-nav-cyan`: `runtime/nissan_gt-r_2008.glb`
- `auralith-nav-graphite`: `runtime/nissan_fairlady_z_s30240z_1978.glb`

Runtime files are generated from `source/` with glTF Transform optimize, Meshopt geometry compression, and 1024px max textures.
The app configures Three.js `GLTFLoader` with `MeshoptDecoder` before loading these files.

`gps-car.glb` is kept only as the previous emergency fallback asset and is no longer referenced by the GPS cursor selector.

The source GLB files were provided locally for this project. Keep the original license/source metadata with any replacement models before deploying them publicly.
