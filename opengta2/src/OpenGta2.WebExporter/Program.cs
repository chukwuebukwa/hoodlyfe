using OpenGta2.WebExporter;

if (args.Length < 2)
{
    Console.Error.WriteLine("Usage: OpenGta2.WebExporter <gta2-root> <reldens-assets-dir> [level] [crop-size]");
    return 1;
}

var options = new ExportOptions(
    Path.GetFullPath(args[0]),
    Path.GetFullPath(args[1]),
    args.Length > 2 ? args[2] : "bil",
    args.Length > 3 ? int.Parse(args[3]) : 64);

var result = new WebAssetExporter(options).Export();
Console.WriteLine($"Exported {result.LevelName} district {result.Width}x{result.Height} at map origin ({result.OriginX}, {result.OriginY}).");
Console.WriteLine($"Spawn: ({result.SpawnX}, {result.SpawnY}) pixels. Walkable cells: {result.WalkableCells}.");
Console.WriteLine($"Browser assets: {options.OutputAssetsDirectory}");
return 0;
