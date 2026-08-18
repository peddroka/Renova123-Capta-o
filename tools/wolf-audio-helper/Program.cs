using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using NAudio.Wave;
using NAudio.CoreAudioApi;

// Local-only compatibility capture. Application Loopback isolation requires the
// Windows Application Loopback API and is intentionally not claimed by this helper yet.
if (args.Contains("--list"))
{
    using var devices = new MMDeviceEnumerator();
    var rows = devices.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active).Select(device => new { id = device.ID, name = device.FriendlyName, state = device.State.ToString() });
    var defaultDevice = devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
    Console.WriteLine(JsonSerializer.Serialize(new { ok = true, isolation = "unavailable", defaultMultimedia = new { id = defaultDevice.ID, name = defaultDevice.FriendlyName }, devices = rows }));
    return 0;
}

var compatibility = args.Contains("--compatibility");
using var singleInstance = new Mutex(true, "Renova123.TheWolf.WolfAudioHelper", out var ownsInstance);
if (!ownsInstance)
{
    Console.Error.WriteLine("HELPER_ALREADY_RUNNING");
    return 0;
}
var processIndex = Array.IndexOf(args, "--process-id");
if (processIndex >= 0 && !compatibility)
{
    Console.Error.WriteLine("PROCESS_ISOLATION_UNAVAILABLE: use --compatibility only with explicit global output capture.");
    return 2;
}
if (!compatibility)
{
    Console.Error.WriteLine("CAPTURE_MODE_REQUIRED: choose --compatibility until Application Loopback isolation is available.");
    return 2;
}

var host = "127.0.0.1"; var port = 3344;
var callId = "";
var deviceId = "";
for (var i = 0; i < args.Length - 1; i++) { if (args[i] == "--host") host = args[i + 1]; if (args[i] == "--port") _ = int.TryParse(args[i + 1], out port); }
for (var i = 0; i < args.Length - 1; i++) { if (args[i] == "--call-id") callId = args[i + 1]; }
for (var i = 0; i < args.Length - 1; i++) { if (args[i] == "--device-id") deviceId = args[i + 1]; }
var cancelled = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cancelled.Cancel(); };
while (!cancelled.IsCancellationRequested)
{
    try
    {
        using var client = new TcpClient();
        await client.ConnectAsync(host, port, cancelled.Token);
        await using var network = client.GetStream();
        using var enumerator = new MMDeviceEnumerator();
        var output = string.IsNullOrWhiteSpace(deviceId)
            ? enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia)
            : enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active).FirstOrDefault(item => item.ID == deviceId)
              ?? enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        using var capture = new WasapiLoopbackCapture(output);
        var helperFrames = 0;
        var helperBytes = 0L;
        await WriteJson(network, new { type = "status", state = "capturing", mode = "compatibility", callId, warning = "Este modo pode capturar outros sons reproduzidos pelo computador.", source = "wasapi-loopback", deviceId = output.ID, device = output.FriendlyName, sampleRate = 24000 });
        capture.DataAvailable += (_, e) =>
        {
            try { var pcm = AudioNormalizer.ToPcm16Mono24k(e.Buffer, e.BytesRecorded, capture.WaveFormat); if (pcm.Length == 0) return; helperFrames += 1; helperBytes += pcm.Length; if (helperFrames == 1 || helperFrames % 50 == 0) Console.WriteLine($"[HELPER] device={output.FriendlyName} frames={helperFrames} bytes={helperBytes} rms={AudioNormalizer.Metrics(pcm).rms:F4} peak={AudioNormalizer.Metrics(pcm).peak:F4}"); WriteFrame(network, pcm); }
            catch (Exception error) { Console.Error.WriteLine(error.Message); try { capture.StopRecording(); } catch { } }
        };
        capture.RecordingStopped += (_, e) => { if (e.Exception is not null) Console.Error.WriteLine(e.Exception.Message); };
        capture.StartRecording();
        try { await Task.Delay(Timeout.Infinite, cancelled.Token); } catch (OperationCanceledException) { }
        try { capture.StopRecording(); } catch { }
    }
    catch (OperationCanceledException) { break; }
    catch (Exception error) { Console.Error.WriteLine($"GATEWAY_RECONNECT: {error.Message}"); }
    if (!cancelled.IsCancellationRequested) await Task.Delay(1000, cancelled.Token);
}
return 0;

static async Task WriteJson(Stream stream, object value) { var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value) + "\n"); await stream.WriteAsync(bytes); await stream.FlushAsync(); }
static void WriteFrame(Stream stream, byte[] pcm) { Span<byte> header = stackalloc byte[4]; BitConverter.TryWriteBytes(header, pcm.Length); stream.Write(header); stream.Write(pcm); stream.Flush(); }

static class AudioNormalizer
{
    public static byte[] ToPcm16Mono24k(byte[] source, int length, WaveFormat format)
    {
        if (length <= 0 || source.Length == 0 || format.SampleRate <= 0) return Array.Empty<byte>();
        var channels = Math.Max(1, format.Channels); var sourceRate = format.SampleRate; var sourceFrames = length / Math.Max(1, format.BitsPerSample / 8) / channels; if (sourceFrames <= 0) return Array.Empty<byte>(); var targetFrames = Math.Max(1, (int)Math.Round(sourceFrames * 24000d / sourceRate)); var output = new byte[targetFrames * 2];
        for (var i = 0; i < targetFrames; i++) { var sourceIndex = Math.Min(sourceFrames - 1, (int)Math.Floor(i * sourceRate / 24000d)); var sum = 0f; for (var c = 0; c < channels; c++) sum += ReadSample(source, (sourceIndex * channels + c) * format.BitsPerSample / 8, format); var sample = Math.Clamp(sum / channels, -1f, 1f); short value = (short)(sample * short.MaxValue); BitConverter.TryWriteBytes(output.AsSpan(i * 2, 2), value); }
        return output;
    }
    public static (float rms, float peak) Metrics(byte[] pcm)
    {
        if (pcm.Length < 2) return (0, 0);
        double sum = 0; var peak = 0f;
        for (var i = 0; i + 1 < pcm.Length; i += 2) { var sample = BitConverter.ToInt16(pcm, i) / 32768f; sum += sample * sample; peak = Math.Max(peak, Math.Abs(sample)); }
        return ((float)Math.Sqrt(sum / Math.Max(1, pcm.Length / 2)), peak);
    }
    private static float ReadSample(byte[] data, int offset, WaveFormat format) { if (offset + (format.BitsPerSample / 8) > data.Length) return 0; return format.BitsPerSample == 32 ? BitConverter.ToSingle(data, offset) : BitConverter.ToInt16(data, offset) / 32768f; }
}
