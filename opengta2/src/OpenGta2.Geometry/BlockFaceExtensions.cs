using OpenGta2.GameData.Map;

namespace OpenGta2.Geometry;

internal static class BlockFaceExtensions
{
    public static ref FaceInfo GetFace(this ref BlockInfo block, Face face)
    {
        switch (face)
        {
            case Face.Top: return ref block.Top;
            case Face.Bottom: return ref block.Bottom;
            case Face.Left: return ref block.Left;
            case Face.Right: return ref block.Right;
            default: return ref block.Lid;
        }
    }
}
