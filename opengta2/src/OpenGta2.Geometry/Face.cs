namespace OpenGta2.Geometry;

[Flags]
internal enum Face : byte
{
    None = 0,
    Top = 1,
    Bottom = 2,
    Left = 4,
    Right = 8,
    Lid = 16
}
