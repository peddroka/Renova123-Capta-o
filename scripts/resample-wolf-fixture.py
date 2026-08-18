import sys
import wave
import numpy as np

source, target = sys.argv[1], sys.argv[2]
with wave.open(source, "rb") as reader:
    samples = np.frombuffer(reader.readframes(reader.getnframes()), dtype=np.int16).astype(np.float32)
    rate = reader.getframerate()
    channels = reader.getnchannels()
if channels > 1:
    samples = samples.reshape(-1, channels).mean(axis=1)
length = round(len(samples) * 24000 / rate)
positions = np.linspace(0, len(samples) - 1, length)
resampled = np.interp(positions, np.arange(len(samples)), samples).clip(-32768, 32767).astype(np.int16)
with wave.open(target, "wb") as writer:
    writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(24000); writer.writeframes(resampled.tobytes())
