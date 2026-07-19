using System.Numerics;
using OpenGta2.GameData.Map;

namespace OpenGta2.Geometry;

public readonly record struct WalkableSurfaceTriangle(Vector3 A, Vector3 B, Vector3 C);

public static class WalkableSurfaceGeometry
{
    public static WalkableSurfaceTriangle[] Build(ref BlockInfo block, Vector3 offset)
    {
        var vertices = new GeometryBuffer<GeometryVertex>();
        var opaque = new GeometryBuffer<int>();
        var alphaTested = new GeometryBuffer<(float DrawOrder, int Index)>();
        SlopeGeometryGenerator.Push(ref block, offset, vertices, opaque, alphaTested);
        var result = new List<WalkableSurfaceTriangle>();
        AddProjectedTriangles(vertices.AsSpan(), opaque.AsSpan(), result);
        AddProjectedTriangles(
            vertices.AsSpan(),
            alphaTested.AsSpan().ToArray().Select(entry => entry.Index).ToArray(),
            result);
        return result.ToArray();
    }

    private static void AddProjectedTriangles(
        ReadOnlySpan<GeometryVertex> vertices,
        ReadOnlySpan<int> indices,
        List<WalkableSurfaceTriangle> result)
    {
        for (var index = 0; index < indices.Length; index += 3)
        {
            var a = vertices[indices[index]].Position;
            var b = vertices[indices[index + 1]].Position;
            var c = vertices[indices[index + 2]].Position;
            if (MathF.Abs(Vector3.Cross(b - a, c - a).Z) <= 0.00001f)
            {
                continue;
            }

            result.Add(new WalkableSurfaceTriangle(a, b, c));
        }
    }
}
