namespace OpenGta2.Geometry;

internal sealed class GeometryBuffer<T>
{
    private T[] _buffer = new T[16];

    public int Length { get; private set; }

    public void Add(T value)
    {
        if (_buffer.Length == Length)
        {
            Array.Resize(ref _buffer, _buffer.Length * 2);
        }

        _buffer[Length++] = value;
    }

    public ReadOnlySpan<T> AsSpan() => _buffer.AsSpan(0, Length);
}
