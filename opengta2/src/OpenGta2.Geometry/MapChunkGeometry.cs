using System.Numerics;
using OpenGta2.GameData.Map;

namespace OpenGta2.Geometry;

public sealed record MapChunkGeometry(
    int X,
    int Y,
    int Size,
    GeometryVertex[] Vertices,
    int[] OpaqueIndices,
    int[] AlphaTestedIndices)
{
    public int TriangleCount => (OpaqueIndices.Length + AlphaTestedIndices.Length) / 3;
}

public static class MapChunkGeometryBuilder
{
    public const int DefaultChunkSize = 8;

    public static MapChunkGeometry Build(Map map, int chunkX, int chunkY, int size = DefaultChunkSize)
    {
        ArgumentNullException.ThrowIfNull(map);
        if (size <= 0) throw new ArgumentOutOfRangeException(nameof(size));
        if (chunkX < 0 || chunkY < 0 || chunkX + size > map.Width || chunkY + size > map.Height)
        {
            throw new ArgumentOutOfRangeException(nameof(chunkX), "Chunk bounds must fit inside the map.");
        }

        var vertices = new GeometryBuffer<GeometryVertex>();
        var opaque = new GeometryBuffer<int>();
        var alphaTested = new GeometryBuffer<(float DrawOrder, int Index)>();
        for (var x = chunkX; x < chunkX + size; x++)
        {
            for (var y = chunkY; y < chunkY + size; y++)
            {
                var column = map.GetColumn(x, y);
                for (var z = column.Offset; z < column.Height; z++)
                {
                    var blockNumber = column.Blocks[z - column.Offset];
                    ref var block = ref map.CompressedMap.Blocks[blockNumber];
                    var offset = new Vector3(x - chunkX, y - chunkY, z);
                    SlopeGeometryGenerator.Push(ref block, offset, vertices, opaque, alphaTested);
                }
            }
        }

        // LINQ ordering is stable, matching the original client. Triangle indices that share
        // draw order must retain insertion order or unrelated faces become connected.
        var sortedAlpha = alphaTested.AsSpan().ToArray()
            .Select((entry, ordinal) => (Entry: entry, Ordinal: ordinal))
            .OrderBy(item => item.Entry.DrawOrder)
            .ThenBy(item => item.Ordinal)
            .Select(item => item.Entry)
            .ToArray();
        var result = new MapChunkGeometry(
            chunkX,
            chunkY,
            size,
            vertices.AsSpan().ToArray(),
            opaque.AsSpan().ToArray(),
            sortedAlpha.Select(entry => entry.Index).ToArray());
        ValidateTriangles(result);
        return result;
    }

    private static void ValidateTriangles(MapChunkGeometry geometry)
    {
        ValidateIndexBuffer(geometry.Vertices, geometry.OpaqueIndices, "opaque");
        ValidateIndexBuffer(geometry.Vertices, geometry.AlphaTestedIndices, "alpha-tested");
    }

    private static void ValidateIndexBuffer(
        IReadOnlyList<GeometryVertex> vertices,
        IReadOnlyList<int> indices,
        string pass)
    {
        if (indices.Count % 3 != 0) throw new InvalidDataException($"{pass} index count is not triangular.");
        for (var index = 0; index < indices.Count; index += 3)
        {
            var first = VertexAt(indices[index]);
            var second = VertexAt(indices[index + 1]);
            var third = VertexAt(indices[index + 2]);
            var maximumEdge = Math.Max(
                Vector3.Distance(first.Position, second.Position),
                Math.Max(
                    Vector3.Distance(second.Position, third.Position),
                    Vector3.Distance(third.Position, first.Position)));
            if (maximumEdge > 2)
            {
                throw new InvalidDataException(
                    $"{pass} triangle {index / 3} spans {maximumEdge:F3} blocks; face ordering is corrupt.");
            }
        }

        return;

        GeometryVertex VertexAt(int vertexIndex)
        {
            if (vertexIndex < 0 || vertexIndex >= vertices.Count)
            {
                throw new InvalidDataException($"{pass} index {vertexIndex} is outside the vertex buffer.");
            }

            return vertices[vertexIndex];
        }
    }
}
