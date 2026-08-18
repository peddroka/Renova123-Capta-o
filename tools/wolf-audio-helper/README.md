# THE WOLF Windows audio helper

This helper is intentionally local-only (`127.0.0.1`). It currently implements a real WASAPI output-loopback stream and normalizes frames to PCM16, mono, 24 kHz. It is an explicit compatibility mode and can include unrelated computer sounds.

Process-specific Application Loopback isolation is not claimed yet. The helper refuses `--process-id` unless `--compatibility` is also supplied, so the application cannot silently capture the wrong source.

Protocol: newline-delimited JSON status messages followed by length-prefixed binary PCM frames (4-byte little-endian length + PCM payload). Build with `dotnet build -c Release`.
