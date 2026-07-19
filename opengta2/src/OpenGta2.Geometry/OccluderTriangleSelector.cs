using System.Numerics;

namespace OpenGta2.Geometry;

public readonly record struct GeometryOccluderBounds(
    float MinX,
    float MinY,
    float MaxX,
    float MaxY,
    float MinZ,
    float MaxZ);

public static class OccluderTriangleSelector
{
    private const float NormalEpsilon = 0.0001f;
    private const float BoundsEpsilon = 0.0001f;

    public static int[] SelectTriangleOrdinals(
        IReadOnlyList<GeometryVertex> vertices,
        IReadOnlyList<int> indices,
        GeometryOccluderBounds bounds)
    {
        if (indices.Count % 3 != 0)
        {
            throw new ArgumentException("Index count must contain complete triangles.", nameof(indices));
        }

        var selected = new List<int>();
        for (var offset = 0; offset < indices.Count; offset += 3)
        {
            var first = vertices[indices[offset]].Position;
            var second = vertices[indices[offset + 1]].Position;
            var third = vertices[indices[offset + 2]].Position;
            if (!Contains(bounds, first) || !Contains(bounds, second) || !Contains(bounds, third))
            {
                continue;
            }

            var normal = Vector3.Cross(second - first, third - first);
            var horizontalNormal = MathF.Sqrt(normal.X * normal.X + normal.Y * normal.Y);
            if (MathF.Abs(normal.Z) <= NormalEpsilon || MathF.Abs(normal.Z) < horizontalNormal)
            {
                continue;
            }

            selected.Add(offset / 3);
        }

        return selected.ToArray();
    }

    public static int[] ExcludeTriangleOrdinals(
        IReadOnlyList<int> indices,
        IReadOnlySet<int> excludedOrdinals)
    {
        if (indices.Count % 3 != 0)
        {
            throw new ArgumentException("Index count must contain complete triangles.", nameof(indices));
        }

        var result = new List<int>(indices.Count - excludedOrdinals.Count * 3);
        for (var offset = 0; offset < indices.Count; offset += 3)
        {
            if (excludedOrdinals.Contains(offset / 3)) continue;
            result.Add(indices[offset]);
            result.Add(indices[offset + 1]);
            result.Add(indices[offset + 2]);
        }
        return result.ToArray();
    }

    public static int[] IndicesAtOrdinals(
        IReadOnlyList<int> indices,
        IReadOnlyList<int> ordinals)
    {
        var result = new int[ordinals.Count * 3];
        for (var index = 0; index < ordinals.Count; index++)
        {
            var sourceOffset = ordinals[index] * 3;
            result[index * 3] = indices[sourceOffset];
            result[index * 3 + 1] = indices[sourceOffset + 1];
            result[index * 3 + 2] = indices[sourceOffset + 2];
        }
        return result;
    }

    private static bool Contains(GeometryOccluderBounds bounds, Vector3 point)
    {
        return point.X >= bounds.MinX - BoundsEpsilon && point.X <= bounds.MaxX + BoundsEpsilon &&
               point.Y >= bounds.MinY - BoundsEpsilon && point.Y <= bounds.MaxY + BoundsEpsilon &&
               point.Z >= bounds.MinZ - BoundsEpsilon && point.Z <= bounds.MaxZ + BoundsEpsilon;
    }
}
