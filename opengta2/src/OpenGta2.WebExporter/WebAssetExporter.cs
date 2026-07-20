using System.Numerics;
using System.Text.Json;
using OpenGta2.GameData.Map;
using OpenGta2.GameData.Riff;
using OpenGta2.GameData.Style;
using OpenGta2.Geometry;
using SkiaSharp;

namespace OpenGta2.WebExporter;

public sealed record ExportOptions(string Gta2Root, string OutputAssetsDirectory, string LevelName, int CropSize);

public sealed record ExportResult(
    string LevelName,
    int OriginX,
    int OriginY,
    int Width,
    int Height,
    int SpawnX,
    int SpawnY,
    int WalkableCells);

public sealed class WebAssetExporter
{
    private const int TileSize = 64;
    private const int PreviewTileSize = 16;
    private const int PlayerFrameSize = 72;
    private const int PlayerSheetColumns = 3;
    private const int PlayerSheetRows = 3;
    private const int VehicleFrameSize = 96;
    private const int ThreeChunkSize = MapChunkGeometryBuilder.DefaultChunkSize;
    private static readonly ThreeOccluderDefinition[] ThreeOccluders =
    [
        new(
            "bil",
            "mercy-hospital",
            new GeometryOccluderBounds(136, 123, 140, 127, 4.9f, 7.1f),
            137.125f,
            127.375f,
            2.0625f),
        new(
            "bil",
            "ammunation-store",
            new GeometryOccluderBounds(103, 107, 107, 110, 4.9f, 7.1f),
            105.75f,
            110.375f,
            2.0625f),
        new(
            "bil",
            "threads-store",
            new GeometryOccluderBounds(123, 107, 130, 110, 4.0f, 7.1f),
            126.5f,
            110.375f,
            2.0625f),
        new(
            "bil",
            "southside-clinic",
            new GeometryOccluderBounds(146, 114, 152, 118, 4.0f, 7.1f),
            149f,
            118.375f,
            2.0625f)
    ];

    private readonly ExportOptions _options;

    public WebAssetExporter(ExportOptions options)
    {
        if (options.CropSize is < 16 or > 256 || options.CropSize % ThreeChunkSize != 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(options),
                "Crop size must be a multiple of 8 between 16 and 256 tiles.");
        }

        _options = options;
    }

    public ExportResult Export()
    {
        var map = ReadMap(Path.Combine(_options.Gta2Root, "data", _options.LevelName + ".gmp"));
        var style = ReadStyle(Path.Combine(_options.Gta2Root, "data", _options.LevelName + ".sty"));
        var surfaces = ReadSurfaces(map, style.Tiles.TileCount);
        ResolvePedestrianFaces(surfaces, style);
        var walkable = FindLargestWalkableArea(surfaces);

        if (walkable.Count == 0)
        {
            throw new InvalidOperationException("The selected map did not contain a walkable surface.");
        }

        var spawn = walkable.MinBy(point => DistanceSquared(point, map.Width / 2, map.Height / 2));
        var width = Math.Min(_options.CropSize, map.Width);
        var height = Math.Min(_options.CropSize, map.Height);
        var originX = Math.Clamp(spawn.X - width / 2, 0, map.Width - width);
        var originY = Math.Clamp(spawn.Y - height / 2, 0, map.Height - height);
        var baseVariants = CollectTileVariants(
            surfaces,
            walkable,
            originX,
            originY,
            width,
            height,
            SelectBaseFaces);
        var overlayVariants = CollectTileVariants(
            surfaces,
            walkable,
            originX,
            originY,
            width,
            height,
            SelectOverlayFaces);

        var mapsDirectory = Path.Combine(_options.OutputAssetsDirectory, "maps");
        var spritesDirectory = Path.Combine(_options.OutputAssetsDirectory, "custom", "sprites");
        Directory.CreateDirectory(mapsDirectory);
        Directory.CreateDirectory(spritesDirectory);
        ExportThreePrototype(map, style, surfaces, mapsDirectory, originX, originY, width, height);
        ExportSurfaceManifest(surfaces, mapsDirectory, originX, originY, width, height, spawn);

        var baseAtlas = CreateAtlas(style, baseVariants);
        var overlayAtlas = CreateAtlas(style, overlayVariants);
        SavePng(baseAtlas.Bitmap, Path.Combine(mapsDirectory, "district-tiles.png"));

        var baseLayerData = CreateLayerData(
            surfaces,
            walkable,
            baseVariants.Gids,
            originX,
            originY,
            width,
            height,
            SelectBaseFaces);
        var overlayLayerData = CreateLayerData(
            surfaces,
            walkable,
            overlayVariants.Gids,
            originX,
            originY,
            width,
            height,
            SelectOverlayFaces);
        var collisionData = CreateCollisionData(walkable, baseVariants.FirstGid, originX, originY, width, height);
        var roadData = CreateGroundTypeData(
            surfaces,
            walkable,
            baseVariants.FirstGid,
            originX,
            originY,
            width,
            height,
            GroundType.Road);
        var tiledMap = CreateTiledMap(width, height, baseAtlas, baseLayerData, collisionData, roadData);
        WriteJson(Path.Combine(mapsDirectory, "district-map.json"), tiledMap);

        using var preview = CreatePreview(baseAtlas.Bitmap, baseLayerData, baseAtlas.Columns, width, height, false);
        using var overlay = CreatePreview(
            overlayAtlas.Bitmap,
            overlayLayerData,
            overlayAtlas.Columns,
            width,
            height,
            true);
        SavePng(preview, Path.Combine(mapsDirectory, "district-preview.png"));
        SavePng(overlay, Path.Combine(mapsDirectory, "district-overlay.png"));

        using var player = CreatePedestrianSheet(style, 25);
        using var civilian = CreatePedestrianSheet(style, 4);
        using var police = CreatePedestrianSheet(style, 17);
        using var vehicles = CreateVehicleSheet(style);
        SavePng(player, Path.Combine(spritesDirectory, "player-base.png"));
        SavePng(civilian, Path.Combine(spritesDirectory, "civilian.png"));
        SavePng(police, Path.Combine(spritesDirectory, "police.png"));
        SavePng(vehicles, Path.Combine(spritesDirectory, "vehicles.png"));

        var spawnX = (spawn.X - originX) * TileSize + TileSize / 2;
        var spawnY = (spawn.Y - originY) * TileSize + TileSize / 2;
        var metadata = new
        {
            source = _options.LevelName,
            tileSize = TileSize,
            origin = new { x = originX, y = originY },
            size = new { width, height },
            spawn = new { x = spawnX, y = spawnY },
            walkableCells = walkable.Count(point => IsInside(point, originX, originY, width, height)),
            roadCells = roadData.Count(gid => gid != 0),
            elevatedPassageCells = CountElevatedPassages(surfaces, walkable, originX, originY, width, height)
        };
        WriteJson(Path.Combine(mapsDirectory, "district-map.metadata.json"), metadata);

        baseAtlas.Bitmap.Dispose();
        overlayAtlas.Bitmap.Dispose();
        return new ExportResult(
            _options.LevelName,
            originX,
            originY,
            width,
            height,
            spawnX,
            spawnY,
            metadata.walkableCells);
    }

    private static Map ReadMap(string path)
    {
        using var stream = File.OpenRead(path);
        using var riff = new RiffReader(stream);
        return new MapReader(riff).Read();
    }

    private static Style ReadStyle(string path)
    {
        using var stream = File.OpenRead(path);
        using var riff = new RiffReader(stream);
        return new StyleReader(riff).Read();
    }

    private static SurfaceCell[,] ReadSurfaces(Map map, int tileCount)
    {
        var result = new SurfaceCell[map.Height, map.Width];
        for (var y = 0; y < map.Height; y++)
        {
            for (var x = 0; x < map.Width; x++)
            {
                var column = map.GetColumn(x, y);
                var faces = new List<TileFace>();
                for (var z = column.Offset; z < column.Height; z++)
                {
                    ref var block = ref map.CompressedMap.Blocks[column.Blocks[z - column.Offset]];
                    var tile = block.Lid.TileGraphic;
                    if (tile == 0 || tile >= tileCount)
                    {
                        continue;
                    }

                    faces.Add(new TileFace(
                        tile,
                        block.Lid.Rotation,
                        block.Lid.Flip,
                        block.SlopeType.GroundType,
                        z + 1,
                        WalkableSurfaceGeometry.Build(ref block, new Vector3(x, y, z))));
                }

                result[y, x] = new SurfaceCell(faces.ToArray());
            }
        }

        return result;
    }

    private static HashSet<GridPoint> FindLargestWalkableArea(SurfaceCell[,] surfaces)
    {
        var height = surfaces.GetLength(0);
        var width = surfaces.GetLength(1);
        var visited = new bool[height, width];
        var largest = new HashSet<GridPoint>();
        var directions = new[] { new GridPoint(1, 0), new GridPoint(-1, 0), new GridPoint(0, 1), new GridPoint(0, -1) };

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                if (visited[y, x] || !surfaces[y, x].IsWalkable)
                {
                    continue;
                }

                var area = new HashSet<GridPoint>();
                var queue = new Queue<GridPoint>();
                queue.Enqueue(new GridPoint(x, y));
                visited[y, x] = true;

                while (queue.TryDequeue(out var point))
                {
                    area.Add(point);
                    var currentHeight = surfaces[point.Y, point.X].PedestrianFace!.Value.Height;
                    foreach (var direction in directions)
                    {
                        var next = new GridPoint(point.X + direction.X, point.Y + direction.Y);
                        if (next.X < 0 || next.Y < 0 || next.X >= width || next.Y >= height || visited[next.Y, next.X])
                        {
                            continue;
                        }

                        var nextSurface = surfaces[next.Y, next.X];
                        var nextFace = nextSurface.PedestrianFace;
                        if (nextFace is null || Math.Abs(nextFace.Value.Height - currentHeight) > 1)
                        {
                            continue;
                        }

                        visited[next.Y, next.X] = true;
                        queue.Enqueue(next);
                    }
                }

                if (area.Count > largest.Count)
                {
                    largest = area;
                }
            }
        }

        return largest;
    }

    private static void ResolvePedestrianFaces(SurfaceCell[,] surfaces, Style style)
    {
        var height = surfaces.GetLength(0);
        var width = surfaces.GetLength(1);
        var candidates = new bool[height, width];

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var surface = surfaces[y, x];
                if (surface.Faces.Count == 0)
                {
                    continue;
                }

                var topFace = surface.Faces[^1];
                var lowerFace = surface.LowestGroundFace;
                if (
                    IsOverheadFace(style, topFace) &&
                    lowerFace is not null &&
                    lowerFace.Value.Height < topFace.Height)
                {
                    surface.PedestrianFace = lowerFace;
                    continue;
                }

                surface.PedestrianFace = topFace.GroundType == GroundType.Air ? null : topFace;
                candidates[y, x] = lowerFace is not null && lowerFace.Value.Height < topFace.Height;
            }
        }

        var visited = new bool[height, width];
        var directions = new[] { new GridPoint(1, 0), new GridPoint(-1, 0), new GridPoint(0, 1), new GridPoint(0, -1) };
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                if (!candidates[y, x] || visited[y, x])
                {
                    continue;
                }

                var component = new List<GridPoint>();
                var queue = new Queue<GridPoint>();
                var topHeight = surfaces[y, x].Faces[^1].Height;
                var minX = x;
                var maxX = x;
                var minY = y;
                var maxY = y;
                queue.Enqueue(new GridPoint(x, y));
                visited[y, x] = true;

                while (queue.TryDequeue(out var point))
                {
                    component.Add(point);
                    minX = Math.Min(minX, point.X);
                    maxX = Math.Max(maxX, point.X);
                    minY = Math.Min(minY, point.Y);
                    maxY = Math.Max(maxY, point.Y);
                    foreach (var direction in directions)
                    {
                        var next = new GridPoint(point.X + direction.X, point.Y + direction.Y);
                        if (
                            next.X < 0 || next.Y < 0 || next.X >= width || next.Y >= height ||
                            visited[next.Y, next.X] || !candidates[next.Y, next.X] ||
                            Math.Abs(surfaces[next.Y, next.X].Faces[^1].Height - topHeight) > 1)
                        {
                            continue;
                        }

                        visited[next.Y, next.X] = true;
                        queue.Enqueue(next);
                    }
                }

                var componentWidth = maxX - minX + 1;
                var componentHeight = maxY - minY + 1;
                var narrowSide = Math.Min(componentWidth, componentHeight);
                var longSide = Math.Max(componentWidth, componentHeight);
                var isLinearStructure = narrowSide <= 2 || (narrowSide <= 6 && longSide >= narrowSide * 3);
                if (!isLinearStructure)
                {
                    continue;
                }

                foreach (var point in component)
                {
                    surfaces[point.Y, point.X].PedestrianFace = surfaces[point.Y, point.X].LowestGroundFace;
                }
            }
        }
    }

    private static TileVariants CollectTileVariants(
        SurfaceCell[,] surfaces,
        IReadOnlySet<GridPoint> walkable,
        int originX,
        int originY,
        int width,
        int height,
        Func<SurfaceCell, bool, IReadOnlyList<TileFace>> selectFaces)
    {
        var gids = new Dictionary<string, uint>();
        var ordered = new List<TileStack>();

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var surface = surfaces[originY + y, originX + x];
                var isWalkable = walkable.Contains(new GridPoint(originX + x, originY + y));
                var faces = selectFaces(surface, isWalkable);
                if (faces.Count == 0)
                {
                    continue;
                }

                var variantKey = VariantKey(faces);
                if (gids.ContainsKey(variantKey))
                {
                    continue;
                }

                ordered.Add(new TileStack(variantKey, faces));
                gids[variantKey] = (uint)ordered.Count;
            }
        }

        if (ordered.Count == 0)
        {
            throw new InvalidOperationException("The selected crop did not contain any renderable tiles.");
        }

        return new TileVariants(ordered, gids, 1);
    }

    private static Atlas CreateAtlas(Style style, TileVariants variants)
    {
        var columns = Math.Min(16, variants.Ordered.Count);
        var rows = (int)Math.Ceiling(variants.Ordered.Count / (double)columns);
        var bitmap = NewBitmap(columns * TileSize, rows * TileSize);
        using var canvas = new SKCanvas(bitmap);
        canvas.Clear(SKColors.Transparent);

        for (var index = 0; index < variants.Ordered.Count; index++)
        {
            using var tile = CreateTileBitmap(style, variants.Ordered[index]);
            var x = index % columns * TileSize;
            var y = index / columns * TileSize;
            canvas.DrawBitmap(tile, x, y);
        }

        return new Atlas(bitmap, columns, rows, variants.Ordered.Count);
    }

    private void ExportThreePrototype(
        Map map,
        Style style,
        SurfaceCell[,] surfaces,
        string mapsDirectory,
        int originX,
        int originY,
        int width,
        int height)
    {
        if (width != height) throw new InvalidOperationException("The 3D district prototype requires a square crop.");
        var surfaceHeights = new float[width * height];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var surface = surfaces[originY + y, originX + x];
                surfaceHeights[y * width + x] = surface.PedestrianFace?.Height ??
                    surface.LowestGroundFace?.Height ?? 0;
            }
        }
        var outputDirectory = Path.Combine(mapsDirectory, "three");
        Directory.CreateDirectory(outputDirectory);
        using var atlas = CreateCompleteTileAtlas(style, out var atlasColumns, out var atlasRows);
        SavePng(atlas, Path.Combine(outputDirectory, "tiles.png"));
        var legacyPath = Path.Combine(outputDirectory, "prototype.json");
        if (width <= 128)
        {
            var selected = MapChunkGeometryBuilder.Build(map, originX, originY, width);
            var occluders = BuildThreeOccluders(selected, originX, originY);
            var excludedOpaque = occluders.SelectMany(group => group.OpaqueTriangleOrdinals).ToHashSet();
            var excludedAlpha = occluders.SelectMany(group => group.AlphaTestedTriangleOrdinals).ToHashSet();
            var payload = new
            {
                version = 2,
                source = "gta2-private-compatibility",
                blockSize = TileSize,
                chunk = new {x = selected.X, y = selected.Y, size = selected.Size},
                atlas = new
                {
                    image = "tiles.png",
                    columns = atlasColumns,
                    rows = atlasRows,
                    tileSize = TileSize,
                    tileCount = style.Tiles.TileCount
                },
                vertices = selected.Vertices.Select(vertex => new
                {
                    x = vertex.Position.X,
                    y = vertex.Position.Y,
                    z = vertex.Position.Z,
                    u = vertex.TextureCoordinate.X,
                    v = vertex.TextureCoordinate.Y,
                    tile = (int)vertex.TextureCoordinate.Z,
                    shade = vertex.Shading
                }),
                opaqueIndices = selected.OpaqueIndices,
                alphaTestedIndices = selected.AlphaTestedIndices,
                baseOpaqueIndices = OccluderTriangleSelector.ExcludeTriangleOrdinals(
                    selected.OpaqueIndices,
                    excludedOpaque),
                baseAlphaTestedIndices = OccluderTriangleSelector.ExcludeTriangleOrdinals(
                    selected.AlphaTestedIndices,
                    excludedAlpha),
                occluders = occluders.Select(group => new
                {
                    id = group.Definition.Id,
                    bounds = new
                    {
                        minX = group.LocalBounds.MinX,
                        minY = group.LocalBounds.MinY,
                        maxX = group.LocalBounds.MaxX,
                        maxY = group.LocalBounds.MaxY,
                        minZ = group.LocalBounds.MinZ,
                        maxZ = group.LocalBounds.MaxZ
                    },
                    exteriorDoor = new
                    {
                        x = group.Definition.DoorX - originX,
                        y = group.Definition.DoorY - originY
                    },
                    floorZ = group.Definition.FloorZ,
                    opaqueIndices = OccluderTriangleSelector.IndicesAtOrdinals(
                        selected.OpaqueIndices,
                        group.OpaqueTriangleOrdinals),
                    alphaTestedIndices = OccluderTriangleSelector.IndicesAtOrdinals(
                        selected.AlphaTestedIndices,
                        group.AlphaTestedTriangleOrdinals),
                    triangleCount = group.OpaqueTriangleOrdinals.Length +
                        group.AlphaTestedTriangleOrdinals.Length
                }),
                surfaces = new {width, height, values = surfaceHeights},
                triangleCount = selected.TriangleCount
            };
            WriteJson(legacyPath, payload);
        }
        else if (File.Exists(legacyPath))
        {
            File.Delete(legacyPath);
        }
        ExportThreeChunks(
            map,
            style,
            surfaces,
            outputDirectory,
            originX,
            originY,
            width,
            height,
            atlasColumns,
            atlasRows);
    }

    private void ExportThreeChunks(
        Map map,
        Style style,
        SurfaceCell[,] surfaces,
        string outputDirectory,
        int originX,
        int originY,
        int width,
        int height,
        int atlasColumns,
        int atlasRows)
    {
        if (width % ThreeChunkSize != 0 || height % ThreeChunkSize != 0)
        {
            throw new InvalidOperationException(
                $"Chunked Three.js export requires crop dimensions divisible by {ThreeChunkSize}.");
        }

        var chunksDirectory = Path.Combine(outputDirectory, "chunks");
        if (Directory.Exists(chunksDirectory)) Directory.Delete(chunksDirectory, recursive: true);
        Directory.CreateDirectory(chunksDirectory);
        var chunkEntries = new List<object>();
        var streamedTriangleCount = 0;
        var occluderTriangleCounts = new Dictionary<string, int>();
        for (var localY = 0; localY < height; localY += ThreeChunkSize)
        {
            for (var localX = 0; localX < width; localX += ThreeChunkSize)
            {
                var column = localX / ThreeChunkSize;
                var row = localY / ThreeChunkSize;
                var geometry = MapChunkGeometryBuilder.Build(
                    map,
                    originX + localX,
                    originY + localY,
                    ThreeChunkSize);
                var chunkOccluders = BuildThreeChunkOccluders(
                    geometry,
                    originX + localX,
                    originY + localY,
                    originX,
                    originY,
                    width,
                    height);
                var excludedOpaque = chunkOccluders
                    .SelectMany(group => group.OpaqueTriangleOrdinals)
                    .ToHashSet();
                var excludedAlpha = chunkOccluders
                    .SelectMany(group => group.AlphaTestedTriangleOrdinals)
                    .ToHashSet();
                var fileName = $"{column}-{row}.json";
                var chunkPayload = new
                {
                    version = 1,
                    column,
                    row,
                    x = localX,
                    y = localY,
                    size = ThreeChunkSize,
                    vertices = geometry.Vertices.Select(vertex => new
                    {
                        x = vertex.Position.X,
                        y = vertex.Position.Y,
                        z = vertex.Position.Z,
                        u = vertex.TextureCoordinate.X,
                        v = vertex.TextureCoordinate.Y,
                        tile = (int)vertex.TextureCoordinate.Z,
                        shade = vertex.Shading
                    }),
                    opaqueIndices = OccluderTriangleSelector.ExcludeTriangleOrdinals(
                        geometry.OpaqueIndices,
                        excludedOpaque),
                    alphaTestedIndices = OccluderTriangleSelector.ExcludeTriangleOrdinals(
                        geometry.AlphaTestedIndices,
                        excludedAlpha),
                    occluders = chunkOccluders.Select(group => new
                    {
                        id = group.Definition.Id,
                        opaqueIndices = OccluderTriangleSelector.IndicesAtOrdinals(
                            geometry.OpaqueIndices,
                            group.OpaqueTriangleOrdinals),
                        alphaTestedIndices = OccluderTriangleSelector.IndicesAtOrdinals(
                            geometry.AlphaTestedIndices,
                            group.AlphaTestedTriangleOrdinals),
                        triangleCount = group.OpaqueTriangleOrdinals.Length +
                            group.AlphaTestedTriangleOrdinals.Length
                    }),
                    triangleCount = geometry.TriangleCount
                };
                WriteCompactJson(Path.Combine(chunksDirectory, fileName), chunkPayload);
                chunkEntries.Add(new
                {
                    id = $"{column}:{row}",
                    column,
                    row,
                    x = localX,
                    y = localY,
                    size = ThreeChunkSize,
                    file = $"chunks/{fileName}",
                    triangleCount = geometry.TriangleCount
                });
                streamedTriangleCount += geometry.TriangleCount;
                foreach (var group in chunkOccluders)
                {
                    var triangleCount = group.OpaqueTriangleOrdinals.Length +
                        group.AlphaTestedTriangleOrdinals.Length;
                    occluderTriangleCounts[group.Definition.Id] =
                        occluderTriangleCounts.GetValueOrDefault(group.Definition.Id) + triangleCount;
                }
            }
        }

        var surfaceHeights = new float[width * height];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var surface = surfaces[originY + y, originX + x];
                surfaceHeights[y * width + x] = surface.PedestrianFace?.Height ??
                    surface.LowestGroundFace?.Height ?? 0;
            }
        }

        var worldOccluders = ThreeOccluders
            .Where(candidate => candidate.LevelName == _options.LevelName)
            .Where(candidate =>
                candidate.SourceBounds.MinX >= originX && candidate.SourceBounds.MinY >= originY &&
                candidate.SourceBounds.MaxX <= originX + width && candidate.SourceBounds.MaxY <= originY + height)
            .ToArray();
        foreach (var definition in worldOccluders)
        {
            if (occluderTriangleCounts.GetValueOrDefault(definition.Id) == 0)
            {
                throw new InvalidDataException($"Chunked occluder '{definition.Id}' selected no lid triangles.");
            }
        }

        var manifest = new
        {
            version = 1,
            revision = $"{_options.LevelName}:{originX}:{originY}:{width}:{height}",
            source = "gta2-private-compatibility",
            blockSize = TileSize,
            origin = new {x = originX, y = originY},
            size = new {width, height},
            chunkSize = ThreeChunkSize,
            atlas = new
            {
                image = "tiles.png",
                columns = atlasColumns,
                rows = atlasRows,
                tileSize = TileSize,
                tileCount = style.Tiles.TileCount
            },
            surfaces = new {width, height, values = surfaceHeights},
            occluders = worldOccluders.Select(definition => new
            {
                id = definition.Id,
                bounds = new
                {
                    minX = definition.SourceBounds.MinX - originX,
                    minY = definition.SourceBounds.MinY - originY,
                    maxX = definition.SourceBounds.MaxX - originX,
                    maxY = definition.SourceBounds.MaxY - originY,
                    minZ = definition.SourceBounds.MinZ,
                    maxZ = definition.SourceBounds.MaxZ
                },
                exteriorDoor = new
                {
                    x = definition.DoorX - originX,
                    y = definition.DoorY - originY
                },
                floorZ = definition.FloorZ,
                triangleCount = occluderTriangleCounts[definition.Id]
            }),
            chunks = chunkEntries,
            triangleCount = streamedTriangleCount
        };
        WriteJson(Path.Combine(outputDirectory, "world.json"), manifest);
    }

    private ThreeOccluderGroup[] BuildThreeChunkOccluders(
        MapChunkGeometry geometry,
        int chunkSourceX,
        int chunkSourceY,
        int cropOriginX,
        int cropOriginY,
        int cropWidth,
        int cropHeight)
    {
        var result = new List<ThreeOccluderGroup>();
        foreach (var definition in ThreeOccluders.Where(candidate => candidate.LevelName == _options.LevelName))
        {
            var source = definition.SourceBounds;
            if (
                source.MinX < cropOriginX || source.MinY < cropOriginY ||
                source.MaxX > cropOriginX + cropWidth || source.MaxY > cropOriginY + cropHeight)
            {
                continue;
            }

            var localBounds = source with
            {
                MinX = Math.Clamp(source.MinX - chunkSourceX, 0, geometry.Size),
                MaxX = Math.Clamp(source.MaxX - chunkSourceX, 0, geometry.Size),
                MinY = Math.Clamp(source.MinY - chunkSourceY, 0, geometry.Size),
                MaxY = Math.Clamp(source.MaxY - chunkSourceY, 0, geometry.Size)
            };
            if (localBounds.MinX >= localBounds.MaxX || localBounds.MinY >= localBounds.MaxY) continue;
            var opaque = OccluderTriangleSelector.SelectTriangleOrdinals(
                geometry.Vertices,
                geometry.OpaqueIndices,
                localBounds);
            var alphaTested = OccluderTriangleSelector.SelectTriangleOrdinals(
                geometry.Vertices,
                geometry.AlphaTestedIndices,
                localBounds);
            if (opaque.Length + alphaTested.Length == 0) continue;
            result.Add(new ThreeOccluderGroup(definition, localBounds, opaque, alphaTested));
        }
        return result.ToArray();
    }

    private static void ExportSurfaceManifest(
        SurfaceCell[,] surfaces,
        string mapsDirectory,
        int originX,
        int originY,
        int width,
        int height,
        GridPoint spawn)
    {
        var faces = new List<SurfaceFace>();
        for (var y = originY; y < originY + height; y++)
        {
            for (var x = originX; x < originX + width; x++)
            {
                foreach (var face in surfaces[y, x].Faces)
                {
                    if (face.GroundType == GroundType.Air || face.Triangles.Count == 0)
                    {
                        continue;
                    }

                    faces.Add(new SurfaceFace(
                        faces.Count,
                        x,
                        y,
                        face,
                        PlaneKey(face.Triangles[0]),
                        BoundaryEdges(face.Triangles)));
                }
            }
        }

        if (faces.Count == 0)
        {
            throw new InvalidDataException("Surface manifest requires at least one walkable face.");
        }

        var edges = new Dictionary<SurfaceEdgeKey, List<(SurfaceFace Face, SurfaceBoundaryEdge Edge)>>();
        foreach (var face in faces)
        {
            foreach (var edge in face.BoundaryEdges)
            {
                if (!edges.TryGetValue(edge.Key, out var entries))
                {
                    entries = [];
                    edges.Add(edge.Key, entries);
                }
                entries.Add((face, edge));
            }
        }

        var parents = Enumerable.Range(0, faces.Count).ToArray();
        foreach (var entries in edges.Values)
        {
            for (var first = 0; first < entries.Count; first++)
            {
                for (var second = first + 1; second < entries.Count; second++)
                {
                    if (entries[first].Face.PlaneKey == entries[second].Face.PlaneKey)
                    {
                        Union(parents, entries[first].Face.Index, entries[second].Face.Index);
                    }
                }
            }
        }

        var grouped = faces.GroupBy(face => Root(parents, face.Index)).ToArray();
        var pedestrianFace = surfaces[spawn.Y, spawn.X].PedestrianFace;
        var defaultFace = faces.FirstOrDefault(face =>
            face.X == spawn.X && face.Y == spawn.Y && face.Face.Height == pedestrianFace?.Height);
        if (defaultFace is null)
        {
            throw new InvalidDataException("Spawn does not resolve to an exported surface.");
        }
        var defaultRoot = Root(parents, defaultFace.Index);
        var surfaceIds = new Dictionary<int, string>();
        foreach (var group in grouped)
        {
            var first = group
                .OrderBy(face => face.Y)
                .ThenBy(face => face.X)
                .ThenBy(face => face.Face.Height)
                .First();
            var id = group.Key == defaultRoot
                ? "street-ground"
                : $"street-surface-{first.X - originX}-{first.Y - originY}-{first.Face.Height}";
            if (surfaceIds.ContainsValue(id))
            {
                throw new InvalidDataException($"Surface ID {id} is not stable and unique.");
            }
            surfaceIds.Add(group.Key, id);
        }
        var defaultSurfaceId = surfaceIds[defaultRoot];

        var actorKinds = new[] {"player", "pedestrian", "vehicle", "projectile", "prop"};
        var exportedSurfaces = grouped
            .Select(group => new
            {
                id = surfaceIds[group.Key],
                spaceId = "street",
                actorKinds,
                triangles = group
                    .SelectMany(face => face.Face.Triangles)
                    .Select(triangle => new
                    {
                        a = SurfacePoint(triangle.A, originX, originY),
                        b = SurfacePoint(triangle.B, originX, originY),
                        c = SurfacePoint(triangle.C, originX, originY)
                    })
                    .ToArray()
            })
            .OrderBy(surface => surface.id, StringComparer.Ordinal)
            .ToArray();

        var exportedTransitions = new List<object>();
        var transitionKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entries in edges.Values)
        {
            for (var first = 0; first < entries.Count; first++)
            {
                for (var second = first + 1; second < entries.Count; second++)
                {
                    var firstRoot = Root(parents, entries[first].Face.Index);
                    var secondRoot = Root(parents, entries[second].Face.Index);
                    if (firstRoot == secondRoot)
                    {
                        continue;
                    }
                    var firstId = surfaceIds[firstRoot];
                    var secondId = surfaceIds[secondRoot];
                    var fromId = string.CompareOrdinal(firstId, secondId) <= 0 ? firstId : secondId;
                    var toId = fromId == firstId ? secondId : firstId;
                    var edge = entries[first].Edge;
                    var transitionKey = $"{fromId}|{toId}|{edge.Key}";
                    if (!transitionKeys.Add(transitionKey))
                    {
                        continue;
                    }
                    exportedTransitions.Add(new
                    {
                        id = $"surface-transition-{exportedTransitions.Count + 1}",
                        fromSurfaceId = fromId,
                        toSurfaceId = toId,
                        from = SurfacePoint2(edge.A, originX, originY),
                        to = SurfacePoint2(edge.B, originX, originY),
                        actorKinds,
                        bidirectional = true
                    });
                }
            }
        }

        WriteJson(Path.Combine(mapsDirectory, "surface-manifest.json"), new
        {
            version = 1,
            collisionRevision = 2,
            blockSize = TileSize,
            defaultSurfaceId,
            surfaces = exportedSurfaces,
            transitions = exportedTransitions
        });
    }

    private static object SurfacePoint(Vector3 point, int originX, int originY) => new
    {
        x = (point.X - originX) * TileSize,
        y = (point.Y - originY) * TileSize,
        z = point.Z * TileSize
    };

    private static object SurfacePoint2(Vector3 point, int originX, int originY) => new
    {
        x = (point.X - originX) * TileSize,
        y = (point.Y - originY) * TileSize
    };

    private static SurfaceBoundaryEdge[] BoundaryEdges(IReadOnlyList<WalkableSurfaceTriangle> triangles)
    {
        var edges = new Dictionary<SurfaceEdgeKey, (int Count, SurfaceBoundaryEdge Edge)>();
        foreach (var triangle in triangles)
        {
            Add(triangle.A, triangle.B);
            Add(triangle.B, triangle.C);
            Add(triangle.C, triangle.A);
        }
        return edges.Values.Where(entry => entry.Count == 1).Select(entry => entry.Edge).ToArray();

        void Add(Vector3 a, Vector3 b)
        {
            var key = SurfaceEdgeKey.From(a, b);
            if (edges.TryGetValue(key, out var entry))
            {
                edges[key] = (entry.Count + 1, entry.Edge);
            }
            else
            {
                edges.Add(key, (1, new SurfaceBoundaryEdge(key, a, b)));
            }
        }
    }

    private static string PlaneKey(WalkableSurfaceTriangle triangle)
    {
        var normal = Vector3.Normalize(Vector3.Cross(triangle.B - triangle.A, triangle.C - triangle.A));
        if (normal.Z < 0)
        {
            normal = -normal;
        }
        return $"{Quantize(normal.X)}:{Quantize(normal.Y)}:{Quantize(normal.Z)}:" +
            $"{Quantize(Vector3.Dot(normal, triangle.A))}";
    }

    private static int Root(int[] parents, int index)
    {
        while (parents[index] != index)
        {
            parents[index] = parents[parents[index]];
            index = parents[index];
        }
        return index;
    }

    private static void Union(int[] parents, int first, int second)
    {
        var firstRoot = Root(parents, first);
        var secondRoot = Root(parents, second);
        if (firstRoot != secondRoot)
        {
            parents[Math.Max(firstRoot, secondRoot)] = Math.Min(firstRoot, secondRoot);
        }
    }

    private static long Quantize(float value) => (long)MathF.Round(value * 100_000);

    private ThreeOccluderGroup[] BuildThreeOccluders(
        MapChunkGeometry geometry,
        int originX,
        int originY)
    {
        var result = new List<ThreeOccluderGroup>();
        foreach (var definition in ThreeOccluders.Where(candidate => candidate.LevelName == _options.LevelName))
        {
            var localBounds = definition.SourceBounds with
            {
                MinX = definition.SourceBounds.MinX - originX,
                MaxX = definition.SourceBounds.MaxX - originX,
                MinY = definition.SourceBounds.MinY - originY,
                MaxY = definition.SourceBounds.MaxY - originY
            };
            if (
                localBounds.MinX < 0 || localBounds.MinY < 0 ||
                localBounds.MaxX > geometry.Size || localBounds.MaxY > geometry.Size)
            {
                continue;
            }

            var opaque = OccluderTriangleSelector.SelectTriangleOrdinals(
                geometry.Vertices,
                geometry.OpaqueIndices,
                localBounds);
            var alphaTested = OccluderTriangleSelector.SelectTriangleOrdinals(
                geometry.Vertices,
                geometry.AlphaTestedIndices,
                localBounds);
            if (opaque.Length + alphaTested.Length == 0)
            {
                throw new InvalidDataException($"Authored occluder '{definition.Id}' selected no lid triangles.");
            }
            result.Add(new ThreeOccluderGroup(definition, localBounds, opaque, alphaTested));
        }
        return result.ToArray();
    }

    private static SKBitmap CreateCompleteTileAtlas(Style style, out int columns, out int rows)
    {
        columns = 32;
        rows = (int)Math.Ceiling(style.Tiles.TileCount / (double)columns);
        var bitmap = NewBitmap(columns * TileSize, rows * TileSize);
        bitmap.Erase(SKColors.Transparent);
        for (var tileNumber = 0; tileNumber < style.Tiles.TileCount; tileNumber++)
        {
            var tile = style.Tiles.GetTile(tileNumber);
            var physicalPalette = style.PaletteIndex.PhysPalette[tileNumber];
            var palette = style.PhysicsalPalette.GetPalette(physicalPalette);
            var offsetX = tileNumber % columns * TileSize;
            var offsetY = tileNumber / columns * TileSize;
            for (byte y = 0; y < TileSize; y++)
            {
                for (byte x = 0; x < TileSize; x++)
                {
                    bitmap.SetPixel(offsetX + x, offsetY + y, GetColor(ref palette, tile[y, x]));
                }
            }
        }

        return bitmap;
    }

    private static uint[] CreateLayerData(
        SurfaceCell[,] surfaces,
        IReadOnlySet<GridPoint> walkable,
        IReadOnlyDictionary<string, uint> gids,
        int originX,
        int originY,
        int width,
        int height,
        Func<SurfaceCell, bool, IReadOnlyList<TileFace>> selectFaces)
    {
        var result = new uint[width * height];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var surface = surfaces[originY + y, originX + x];
                var isWalkable = walkable.Contains(new GridPoint(originX + x, originY + y));
                var faces = selectFaces(surface, isWalkable);
                if (faces.Count == 0)
                {
                    continue;
                }

                result[y * width + x] = gids[VariantKey(faces)];
            }
        }

        return result;
    }

    private static uint[] CreateCollisionData(
        IReadOnlySet<GridPoint> walkable,
        uint collisionGid,
        int originX,
        int originY,
        int width,
        int height)
    {
        var result = new uint[width * height];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                if (!walkable.Contains(new GridPoint(originX + x, originY + y)))
                {
                    result[y * width + x] = collisionGid;
                }
            }
        }

        return result;
    }

    private static uint[] CreateGroundTypeData(
        SurfaceCell[,] surfaces,
        IReadOnlySet<GridPoint> walkable,
        uint markerGid,
        int originX,
        int originY,
        int width,
        int height,
        GroundType groundType)
    {
        var result = new uint[width * height];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var point = new GridPoint(originX + x, originY + y);
                var face = surfaces[point.Y, point.X].PedestrianFace;
                if (walkable.Contains(point) && face?.GroundType == groundType)
                {
                    result[y * width + x] = markerGid;
                }
            }
        }

        return result;
    }

    private static object CreateTiledMap(
        int width,
        int height,
        Atlas atlas,
        uint[] ground,
        uint[] collisions,
        uint[] roads)
    {
        return new
        {
            compressionlevel = -1,
            height,
            infinite = false,
            layers = new object[]
            {
                new
                {
                    data = ground,
                    height,
                    id = 1,
                    name = "ground",
                    opacity = 1,
                    type = "tilelayer",
                    visible = true,
                    width,
                    x = 0,
                    y = 0
                },
                new
                {
                    data = collisions,
                    height,
                    id = 2,
                    name = "collisions",
                    opacity = 0,
                    type = "tilelayer",
                    visible = false,
                    width,
                    x = 0,
                    y = 0
                },
                new
                {
                    data = roads,
                    height,
                    id = 3,
                    name = "roads",
                    opacity = 0,
                    type = "tilelayer",
                    visible = false,
                    width,
                    x = 0,
                    y = 0
                }
            },
            nextlayerid = 4,
            nextobjectid = 1,
            orientation = "orthogonal",
            renderorder = "right-down",
            tiledversion = "1.11.2",
            tileheight = TileSize,
            tilesets = new object[]
            {
                new
                {
                    columns = atlas.Columns,
                    firstgid = 1,
                    image = "district-tiles.png",
                    imageheight = atlas.Rows * TileSize,
                    imagewidth = atlas.Columns * TileSize,
                    margin = 0,
                    name = "district",
                    spacing = 0,
                    tilecount = atlas.TileCount,
                    tileheight = TileSize,
                    tilewidth = TileSize
                }
            },
            tilewidth = TileSize,
            type = "map",
            version = "1.10",
            width
        };
    }

    private static SKBitmap CreatePreview(
        SKBitmap atlas,
        uint[] layerData,
        int atlasColumns,
        int width,
        int height,
        bool transparent)
    {
        var preview = NewBitmap(width * PreviewTileSize, height * PreviewTileSize);
        using var canvas = new SKCanvas(preview);
        canvas.Clear(transparent ? SKColors.Transparent : new SKColor(12, 14, 16));

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var gid = layerData[y * width + x];
                if (gid == 0)
                {
                    continue;
                }

                var tileIndex = (int)gid - 1;
                var source = new SKRectI(
                    tileIndex % atlasColumns * TileSize,
                    tileIndex / atlasColumns * TileSize,
                    tileIndex % atlasColumns * TileSize + TileSize,
                    tileIndex / atlasColumns * TileSize + TileSize);
                var destination = new SKRectI(
                    x * PreviewTileSize,
                    y * PreviewTileSize,
                    x * PreviewTileSize + PreviewTileSize,
                    y * PreviewTileSize + PreviewTileSize);
                canvas.DrawBitmap(atlas, source, destination);
            }
        }

        return preview;
    }

    private static SKBitmap CreateTileBitmap(Style style, TileStack stack)
    {
        var result = NewBitmap(TileSize, TileSize);
        using var canvas = new SKCanvas(result);
        canvas.Clear(SKColors.Transparent);

        foreach (var face in stack.Faces)
        {
            using var faceBitmap = NewBitmap(TileSize, TileSize);
            var tile = style.Tiles.GetTile(face.Tile);
            var physicalPalette = style.PaletteIndex.PhysPalette[face.Tile];
            var palette = style.PhysicsalPalette.GetPalette(physicalPalette);

            for (var y = 0; y < TileSize; y++)
            {
                for (var x = 0; x < TileSize; x++)
                {
                    var source = MapPixel(x, y, face.Rotation, face.Flip);
                    var entry = tile[(byte)source.Y, (byte)source.X];
                    faceBitmap.SetPixel(x, y, GetColor(ref palette, entry));
                }
            }

            canvas.DrawBitmap(faceBitmap, 0, 0);
        }

        return result;
    }

    private static SKBitmap CreatePedestrianSheet(Style style, int remap)
    {
        var spriteBase = style.SpriteBases.GetOffset(SpriteKind.Ped);
        var virtualPalette = style.PaletteBase.GetRemapOffset(SpriteKind.Ped) + remap;
        var physicalPalette = style.PaletteIndex.PhysPalette[virtualPalette];
        var palette = style.PhysicsalPalette.GetPalette(physicalPalette);
        var sheet = NewBitmap(PlayerFrameSize * PlayerSheetColumns, PlayerFrameSize * PlayerSheetRows);
        var animationFrames = new ushort[]
        {
            158 + 53,
            158 + 8,
            158 + 9,
            158 + 10,
            158 + 11,
            158 + 12,
            158 + 13,
            158 + 14,
            158 + 15
        };

        const int scale = 2;
        for (var frameIndex = 0; frameIndex < animationFrames.Length; frameIndex++)
        {
            var frameNumber = animationFrames[frameIndex];
            var entry = style.SpriteEntries[spriteBase + frameNumber];
            var sprite = style.SpriteGraphics[entry.PageNumber].GetSprite(entry, (ushort)(spriteBase + frameNumber));
            var frameX = frameIndex % PlayerSheetColumns;
            var frameY = frameIndex / PlayerSheetColumns;
            var offsetX = (PlayerFrameSize - sprite.Width * scale) / 2;
            var offsetY = (PlayerFrameSize - sprite.Height * scale) / 2;

            for (byte y = 0; y < sprite.Height; y++)
            {
                for (byte x = 0; x < sprite.Width; x++)
                {
                    var color = GetColor(ref palette, sprite[y, x]);
                    for (var sy = 0; sy < scale; sy++)
                    {
                        for (var sx = 0; sx < scale; sx++)
                        {
                            sheet.SetPixel(
                                frameX * PlayerFrameSize + offsetX + x * scale + sx,
                                frameY * PlayerFrameSize + offsetY + y * scale + sy,
                                color);
                        }
                    }
                }
            }
        }

        return sheet;
    }

    private static SKBitmap CreateVehicleSheet(Style style)
    {
        var spriteBase = style.SpriteBases.GetOffset(SpriteKind.Car);
        var modelNumbers = new ushort[] { 5, 12, 56 };
        var sheet = NewBitmap(VehicleFrameSize * modelNumbers.Length, VehicleFrameSize);
        using var canvas = new SKCanvas(sheet);
        using var paint = new SKPaint { IsAntialias = false };
        canvas.Clear(SKColors.Transparent);

        for (var frameIndex = 0; frameIndex < modelNumbers.Length; frameIndex++)
        {
            var spriteNumber = modelNumbers[frameIndex];
            var entry = style.SpriteEntries[spriteBase + spriteNumber];
            var sprite = style.SpriteGraphics[entry.PageNumber].GetSprite(entry, (ushort)(spriteBase + spriteNumber));
            var virtualPalette = style.PaletteBase.SpriteOffset + sprite.Number;
            var physicalPalette = style.PaletteIndex.PhysPalette[virtualPalette];
            var palette = style.PhysicsalPalette.GetPalette(physicalPalette);
            using var spriteBitmap = NewBitmap(sprite.Width, sprite.Height);

            for (byte y = 0; y < sprite.Height; y++)
            {
                for (byte x = 0; x < sprite.Width; x++)
                {
                    spriteBitmap.SetPixel(x, y, GetColor(ref palette, sprite[y, x]));
                }
            }

            const float padding = 4;
            var scale = Math.Min(1, Math.Min(
                (VehicleFrameSize - padding * 2) / sprite.Width,
                (VehicleFrameSize - padding * 2) / sprite.Height));
            var width = sprite.Width * scale;
            var height = sprite.Height * scale;
            var left = frameIndex * VehicleFrameSize + (VehicleFrameSize - width) / 2;
            var top = (VehicleFrameSize - height) / 2;
            canvas.DrawBitmap(spriteBitmap, new SKRect(left, top, left + width, top + height), paint);
        }

        return sheet;
    }

    private static SKPointI MapPixel(int x, int y, Rotation rotation, bool flip)
    {
        var sourceX = flip ? TileSize - 1 - x : x;
        var sourceY = y;
        return rotation switch
        {
            Rotation.Rotate90 => new SKPointI(sourceY, TileSize - 1 - sourceX),
            Rotation.Rotate180 => new SKPointI(TileSize - 1 - sourceX, TileSize - 1 - sourceY),
            Rotation.Rotate270 => new SKPointI(TileSize - 1 - sourceY, sourceX),
            _ => new SKPointI(sourceX, sourceY)
        };
    }

    private static SKColor GetColor(ref Palette palette, byte entry)
    {
        if (entry == 0)
        {
            return SKColors.Transparent;
        }

        var color = palette.GetColor(entry);
        return new SKColor(color.R, color.G, color.B, 255);
    }

    private static SKBitmap NewBitmap(int width, int height)
    {
        return new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
    }

    private static void SavePng(SKBitmap bitmap, string path)
    {
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        using var stream = File.Create(path);
        data.SaveTo(stream);
    }

    private static void WriteJson(string path, object value)
    {
        var options = new JsonSerializerOptions { WriteIndented = true };
        File.WriteAllText(path, JsonSerializer.Serialize(value, options));
    }

    private static void WriteCompactJson(string path, object value)
    {
        File.WriteAllText(path, JsonSerializer.Serialize(value));
    }

    private static long DistanceSquared(GridPoint point, int x, int y)
    {
        var dx = point.X - x;
        var dy = point.Y - y;
        return (long)dx * dx + (long)dy * dy;
    }

    private static bool IsInside(GridPoint point, int originX, int originY, int width, int height)
    {
        return point.X >= originX && point.Y >= originY && point.X < originX + width && point.Y < originY + height;
    }

    private static IReadOnlyList<TileFace> SelectBaseFaces(SurfaceCell surface, bool isWalkable)
    {
        if (!isWalkable || surface.PedestrianFace is not { } pedestrianFace)
        {
            return surface.Faces;
        }

        return new[] { pedestrianFace };
    }

    private static IReadOnlyList<TileFace> SelectOverlayFaces(SurfaceCell surface, bool isWalkable)
    {
        if (!isWalkable || surface.PedestrianFace is not { } pedestrianFace)
        {
            return Array.Empty<TileFace>();
        }

        for (var index = 0; index < surface.Faces.Count; index++)
        {
            if (surface.Faces[index] == pedestrianFace)
            {
                return surface.Faces.Skip(index + 1).ToArray();
            }
        }

        return Array.Empty<TileFace>();
    }

    private static int CountElevatedPassages(
        SurfaceCell[,] surfaces,
        IReadOnlySet<GridPoint> walkable,
        int originX,
        int originY,
        int width,
        int height)
    {
        var count = 0;
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var point = new GridPoint(originX + x, originY + y);
                if (walkable.Contains(point) && SelectOverlayFaces(surfaces[point.Y, point.X], true).Count > 0)
                {
                    count++;
                }
            }
        }

        return count;
    }

    private static string VariantKey(IReadOnlyList<TileFace> faces)
    {
        return string.Join(';', faces.Select(face => $"{face.Tile}:{(byte)face.Rotation}:{face.Flip}"));
    }

    private static bool IsOverheadFace(Style style, TileFace face)
    {
        if (face.Tile is 865 or 871)
        {
            return true;
        }

        var tile = style.Tiles.GetTile(face.Tile);
        var opaquePixels = 0;
        for (byte y = 0; y < TileSize; y++)
        {
            for (byte x = 0; x < TileSize; x++)
            {
                if (tile[y, x] != 0)
                {
                    opaquePixels++;
                }
            }
        }

        return opaquePixels <= TileSize * TileSize * 0.72;
    }

    private sealed class SurfaceCell
    {
        public SurfaceCell(IReadOnlyList<TileFace> faces)
        {
            Faces = faces;
        }

        public IReadOnlyList<TileFace> Faces { get; }
        public TileFace? PedestrianFace { get; set; }
        public bool HasTile => Faces.Count != 0;
        public TileFace? LowestGroundFace
        {
            get
            {
                foreach (var face in Faces)
                {
                    if (face.GroundType != GroundType.Air)
                    {
                        return face;
                    }
                }

                return null;
            }
        }
        public bool IsWalkable => PedestrianFace is not null;
    }

    private readonly record struct TileFace(
        ushort Tile,
        Rotation Rotation,
        bool Flip,
        GroundType GroundType,
        int Height,
        IReadOnlyList<WalkableSurfaceTriangle> Triangles);
    private sealed record SurfaceFace(
        int Index,
        int X,
        int Y,
        TileFace Face,
        string PlaneKey,
        IReadOnlyList<SurfaceBoundaryEdge> BoundaryEdges);
    private readonly record struct SurfaceBoundaryEdge(
        SurfaceEdgeKey Key,
        Vector3 A,
        Vector3 B);
    private readonly record struct QuantizedPoint(long X, long Y, long Z) : IComparable<QuantizedPoint>
    {
        public static QuantizedPoint From(Vector3 point) => new(
            Quantize(point.X),
            Quantize(point.Y),
            Quantize(point.Z));

        public int CompareTo(QuantizedPoint other)
        {
            var x = X.CompareTo(other.X);
            if (x != 0) return x;
            var y = Y.CompareTo(other.Y);
            return y != 0 ? y : Z.CompareTo(other.Z);
        }
    }
    private readonly record struct SurfaceEdgeKey(QuantizedPoint A, QuantizedPoint B)
    {
        public static SurfaceEdgeKey From(Vector3 first, Vector3 second)
        {
            var a = QuantizedPoint.From(first);
            var b = QuantizedPoint.From(second);
            return a.CompareTo(b) <= 0 ? new(a, b) : new(b, a);
        }
    }
    private sealed record TileStack(string Key, IReadOnlyList<TileFace> Faces);
    private readonly record struct GridPoint(int X, int Y);
    private sealed record TileVariants(
        IReadOnlyList<TileStack> Ordered,
        IReadOnlyDictionary<string, uint> Gids,
        uint FirstGid);
    private sealed record Atlas(SKBitmap Bitmap, int Columns, int Rows, int TileCount);
    private sealed record ThreeOccluderDefinition(
        string LevelName,
        string Id,
        GeometryOccluderBounds SourceBounds,
        float DoorX,
        float DoorY,
        float FloorZ);
    private sealed record ThreeOccluderGroup(
        ThreeOccluderDefinition Definition,
        GeometryOccluderBounds LocalBounds,
        int[] OpaqueTriangleOrdinals,
        int[] AlphaTestedTriangleOrdinals);
}
