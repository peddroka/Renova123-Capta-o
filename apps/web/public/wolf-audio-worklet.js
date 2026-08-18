class WolfCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel?.length) { const samples = channel.slice(0); this.port.postMessage({ samples }, [samples.buffer]); }
    return true;
  }
}

registerProcessor("wolf-capture", WolfCaptureProcessor);
