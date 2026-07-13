using System.Numerics;

namespace OpenGta2.Geometry;

public readonly record struct GeometryVertex(
    Vector3 Position,
    Vector3 TextureCoordinate,
    float Shading);
