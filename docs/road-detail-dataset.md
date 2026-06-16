# Road Detail Dataset

This dataset is the new MVP layer for high-zoom road detail. It is separate from
the base map and from parking, POI, building, and route layers. The browser uses
`public/data/road-details/road-details.geojson` as the active GeoJSON source.
`sample-road-details.geojson` is kept only as a compact schema example. A later
production path can generate MVT/MBTiles and then PMTiles with the same
normalized properties.

## Rendering Rules

- Base roads continue to come from OpenFreeMap.
- Road detail appears only on high zooms: lanes from z16, markings and crossings
  from z17, small traffic-calming symbols from z18.
- The MVP uses thin MapLibre `line` and `fill` layers. It does not generate full
  physical road polygons without measured geometry.
- Lane placement uses `offset_px`. The original metric value can be retained in
  `offset_m`, but MapLibre line offsets are rendered in screen pixels.
- Labels and POI stay above road detail layers.
- Global road centerlines are not enough for HD detail. Turn arrows, gore areas,
  islands, bus lanes, and lane markings must come from this dataset or a
  generated derivative, not from guessed full-map styling.

## Feature Types

All features require `properties.feature_type` and non-empty geometry.

### road_centerline

LineString for the road reference line.

Required fields: `road_id`, `class`.

Useful fields: `name`, `oneway`, `lanes_total`, `lanes_forward`,
`lanes_backward`, `surface`, `maxspeed`, `bridge`, `tunnel`, `z_order`.

### road_lane

LineString for a lane rendered with `line-offset`.

Required fields: `road_id`, `lane_id`, `lane_index`, `direction`, `lane_type`.

Useful fields: `turn`, `width_m`, `offset_m`, `offset_px`.

Allowed `lane_type` values: `regular`, `bus`, `taxi`, `tram`, `bike`,
`parking`, `turn_only`, `shoulder`.

Allowed `turn` values: `none`, `through`, `left`, `right`, `slight_left`,
`slight_right`, `through_left`, `through_right`, `u_turn`.

### lane_marking

LineString for lane separators or edge markings.

Required fields: `road_id`, `marking_id`, `marking_type`.

Useful fields: `color`, `between_lanes`, `width_m`, `offset_m`, `offset_px`.

Allowed `marking_type` values: `solid`, `dashed`, `double_solid`,
`solid_dashed`, `dashed_solid`, `bus_lane_marking`, `edge_line`.

### bus_lane

LineString for a bus lane overlay. It can also be represented as `road_lane`
with `lane_type = bus`; the explicit type is useful when access and hours matter.

Required fields: `road_id`, `lane_id`, `direction`.

Useful fields: `access`, `active_hours`, `offset_m`, `offset_px`.

### crosswalk

LineString or Polygon for a pedestrian crossing.

Required fields: `crosswalk_id`, `crossing_type`.

Useful fields: `road_id`, `controlled`, `traffic_signals`, `width_m`.

### stop_line

LineString for a stop line before a signal or crossing.

Required fields: `road_id`, `stop_line_id`.

Useful fields: `related_crosswalk_id`, `width_m`.

### traffic_calming

LineString or small Polygon for a speed hump, table, cushion, or rumble strip.

Required fields: `traffic_calming_id`, `calming_type`.

Allowed `calming_type` values: `hump`, `table`, `cushion`, `rumble_strip`.

### traffic_island

Polygon for a refuge island or separator.

Required fields: `island_id`, `island_type`.

Useful fields: `road_id`, `surface`.

### parking_lane

LineString for a parking lane or bay.

Required fields: `road_id`, `parking_id`, `parking_type`.

Useful fields: `orientation`, `paid`, `capacity_estimate`, `offset_m`,
`offset_px`.

### road_edge

LineString for curb or carriageway edge detail.

Required fields: `road_id`, `edge_id`, `edge_type`.

Useful fields: `offset_m`, `offset_px`.

### turn_arrow

Point for a lane-level turn arrow.

Required fields: `road_id`, `lane_id`, `arrow_id`, `turn`.

Useful fields: `lane_index`, `direction`, `bearing`, `source`.

### gore_area

Polygon for painted gore zones, separator hatching, or physical channelization
areas near ramps and merges.

Required fields: `gore_id`, `gore_type`.

Useful fields: `road_id`, `surface`, `source`, `osm_id`.

## Validation

Run:

```bash
npm run validate:road-details
```

The validator checks feature types, required fields, unique IDs per feature type,
and non-empty geometries.

## OSM Seed Build

Generate a first-pass dataset from OSM/Overpass:

```bash
npm run build:road-details-osm
```

The default bbox is Moscow core: `55.48,37.30,55.96,37.96`.
You can pass another bbox as `south,west,north,east`:

```bash
node scripts/geo/build-road-details-from-osm.mjs 55.70,37.55,55.78,37.70
```

This script derives lanes, lane markings, bus lanes, and turn arrows from OSM
tags such as `lanes`, `lanes:forward`, `lanes:backward`, `turn:lanes`, and
`bus:lanes`. It also imports `area:highway` polygons as `gore_area` when tagged.
The output is a seed dataset, not final truth; complex interchanges still need
manual/imagery QA.

## Vector Tile Build

For a later static tile artifact:

```bash
node scripts/geo/build-road-detail-tiles.mjs
pmtiles convert public/data/road-details/road-details.mbtiles public/data/road-details/road-details.pmtiles
```

The MapLibre vector source is already represented in code as
`pmtiles://road-details.pmtiles`, but the MVP uses GeoJSON by default.
