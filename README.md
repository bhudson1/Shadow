# SOLAR/IMPACT – browser-based 3D equinox shadow study

This is a **working prototype** for visualizing **existing shade vs. net-new shade** and measuring changes across a spring or autumn equinox day. It is a static website and can be hosted for free on GitHub Pages. It is **not yet a verified replacement for an ArcGIS Pro regulatory solar study**.

## Start it

This site loads Three.js modules from public CDNs, so it needs an internet connection, even in the local version. It makes optional live queries to public OpenStreetMap/Overpass services.

From inside `solar-impact-web` run:

```powershell
py -m http.server 8000
```

Then open http://localhost:8000 in Chrome or Edge. Alternatively, publish the folder as the root of a GitHub Pages repository.

The page opens with a generated **demonstration site** and demonstration proposed building, so it can be explored before any data is loaded.

## What is included

- WebGL 3D viewer with orbit/zoom and accurate mesh-rendered cast shadows.
- Spring/September equinox date selection, sun direction, and a 06:00–20:00 Pacific Time slider.
- Lat/lon position and automatic OpenStreetMap **building footprint + height approximation** and roads using Overpass.
- Local file upload for proposed **GLB / OBJ / STL**, detailed *existing* 3D context, and triangulated terrain surface; `.glb` is recommended. `.gltf` requires embedded buffers and textures or a properly hosted external file tree.
- Geometric **ray intersections with BVH acceleration**, testing existing buildings/terrain before the proposal; colours are blue existing, coral net-new, pale green sunlit.
- Sampling resolution 4, 2, 1 or 0.5 metres across an editable circular study area.
- Daily new-shadow minutes per receiving cell, existing-shadow minutes, total impacted area (m²), and integrated m²·hours.
- Export georeferenced **GeoJSON points** with added/existing shadow duration and site elevation, per-interval **CSV** existing and new shadow areas, and a **JSON** study summary.
- Approximate 2026+ Vancouver Pacific Time (UTC−7), reflecting the province's shift to permanent Pacific time in 2026.

## How existing vs. new is computed

At each *receiving point* and each sampled sun position, trace a ray from the receiver **toward the sun**:

1. If the ray intersects existing buildings or terrain, this receiving point is `existing shadow`.
2. Otherwise, if it intersects the proposed model, it is `net-new shadow`.
3. Otherwise it is sunlit. A point shaded by *both* existing buildings and the proposal remains **existing**, and does not contribute to net-new impacts.

This is a geometric 3D operation, not an image overlay or an extruded-footprint approximation. An imported complex roof will have its exact triangles intersected. The renderer also casts graphical 3D shadows, but **the exported statistics do not rely on graphical shader precision**.

For daily statistics, time slots are midpoint samples of the chosen interval (5–60 minutes) over 06:00–20:00. The surface grid samples the *highest receiving surface* from a downward ray through the existing-building context/terrain. Each cell represents **horizontal projected area** equal to spacing². Cells covered by the proposed building are omitted to avoid counting ground beneath the building. This means some portions of the existing rooftops are receiving surfaces, but **facades and vertical receiving surfaces are not sampled** in this prototype.

**Boundary effects**: results are approximate at the grid resolution and are restricted to the selected circular study area. They do **not** include impacts outside that area. Since values are computed at each cell centre, refining to 0.5 or 1 m helps estimate areas more closely but does not remedy inaccurate/misaligned geometry. Terrain outside the study area can affect the shadow, so the *terrain mesh should extend well beyond* the study area, especially at low sun angles. OSM queries include only an extra 100 m buffer by default, and will not capture all potentially relevant distant occluders.

## Model registration and required axes

For accurate comparisons, you need **common registration and common vertical datum**, not just files that visually appear nearby.

- The scene coordinate system is **right-handed, metres**, with **X = east**, **Y = elevation/up**, and **Z = south (−Z = north)**.
- The local origin `(0,0,0)` is the configured site latitude/longitude at **local reference elevation 0**. It is *not* UTM easting/northing or absolute elevation.
- Terrain and existing-building meshes must be exported **into this same local origin**, with accurate relative elevation and *do not auto-centre on loading*. Distinct context/terrain files must therefore already line up.
- **Only the proposed building** is automatically moved horizontally to the origin and vertically so its lowest point is 0, to simplify initial placement. Use the four positioning fields for east, north, vertical height and rotation. For regulatory work, use controlled known offsets and verify the alignment with control points.
- A model exported directly from ArcGIS Pro may have large **UTM eastings/northings, geodetic heights, or a Z-up coordinate system** and will *not* import properly without conversion. Do not upload an unconverted multipatch and assume it is georeferenced.
- Converted OBJ and STL should have baked transforms, metre units, Y-up. GLB is preferred for its predictable mesh handling. Ensure no self-intersections and no extraneous underground volumes; rooftop details that cast shadow must be modeled.
- Input model file and context file are processed locally in the browser and are not uploaded to a backend. OSM requests do reveal the study location to the external map data provider.

### Recommended ArcGIS Pro workflow for Vancouver

1. Start with your precise proposed and surrounding **multipatch** buildings and the project's *bare earth* DTM (not DSM, which duplicates existing roofs as ground).
2. Crop an AOI that includes surrounding occluders beyond the receivers; low sun elevations create long shadows.
3. Reproject into an agreed local reference in **NAD83 / UTM 10N**, then subtract *the same exact coordinate origin and base height* from every vertex, and convert `(E, N, Up)` to `(X=E, Y=Up, Z=−N)`.
4. Convert multipatches and DTM triangulation to one or more **watertight-ish GLB meshes**, preserving roof geometry and terrain triangles. Blender, GIS conversion tools, or a targeted ArcPy export pipeline can perform the transformation.
5. Upload buildings as **detailed existing context**, terrain as the **terrain mesh**, and the proposal independently. Check site control points and roof heights before measuring.
6. For authoritative, repeatable analysis retain original coordinate metadata, source dates, model versions, terrain datum, grid spacing, shadow sampling interval, and study footprint.

City of Vancouver's 2024 3D submission specification requests 1:1 models in UTM83-10 and accurate roof pitches, terraces and rooftop equipment: https://vancouver.ca/files/cov/model-submission-standards.pdf

City 2022 LiDAR: https://opendata.vancouver.ca/explore/dataset/lidar-2022/ . Published LiDAR point data is in NAD83(CSRS) / UTM 10, CGVD28GVRD vertical datum; its 2022 vintage must be reconciled with development since then.

## Data quality tiers

| Context | Capability | Suitable for |
|---|---|---|
| Generated demo | Fake generic buildings on flat plane | Explore app UI and calculations |
| OSM with footprint/height | Existing building approximations, flat plane | Early visual screening only |
| Detailed building GLB + bare-earth terrain GLB + accurate proposal GLB | Real mesh intersections and topographic occlusion | Technical validation after checking model registration and grid/time convergence |

**This prototype is not yet ready for approval-grade solar impact calculations.** It requires validated input geometry, comparison to trusted ArcGIS shadows, independent verification of solar ephemeris/time conventions, handling of structures/receptors outside the AOI, daylight limits at very low altitudes, and the specific municipal method for which ground/roof/park/facade surfaces count.

## Known limitations / potential enhancements

- OSM height tags are often missing; fallback is `building:levels × 3.1 m` or 12 m. OSM uses flat roof extrusions. It can miss multipolygon buildings and does not reflect roof slopes. OSM Overpass is best effort and rate-limited.
- Current ground/roof receivers are sampled as 2D horizontal cells; no facade-area, volumetric radiation, vegetation, seasonal foliage, glazing, or reflected sunlight is assessed. Planimetric grid over steep topography differs from physical sloping area.
- Shadow-map visual resolution and ambient lighting differ from the accurate geometric ray test. The **colour-coded overlay and exported numbers use the ray test** and may not exactly coincide with soft rendered-edge shadows.
- Results for March/September use a Meeus **mean equinox date approximation** to select the day, and a SunCalc-derived solar position. This is sufficient to prototype but requires external solar ephemeris validation before regulatory use.
- Sampled time interval introduces integration uncertainty, particularly near sunrise and sunset. 5/15 minutes is preferable to 60 for numerical convergence.
- Browser-only analysis may become slow or use too much RAM at 0.5m, larger AOIs or complex models. The **Cancel** control stops between time slots, not during a single long batch.
- The browser must access external JS CDNs. This is free GitHub Pages compatible; fully offline use needs locally bundled dependencies.
- Existing context building location and terrain outside the site's study circle affect sunlight. The OSM automatic query buffer is limited and may miss far-away towers or mountains. For precise use, supply more complete meshed context and terrain.

## Files

- `index.html` – application and controls
- `style.css` – responsive UI
- `app.js` – 3D viewer, sun geometry, building imports, raycast analysis, exports

## License / attribution

Application source is shared for prototyping. Third-party Three.js is MIT; `three-mesh-bvh` is MIT; OSM building data is © OpenStreetMap contributors and subject to ODbL attribution requirements. Cite Vancouver open-data sources according to their terms. Do not publish private or restricted municipal data publicly without authorization.
