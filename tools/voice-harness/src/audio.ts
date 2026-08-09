/**
 * Synthetic audio for the fake gateway: little-endian Int16 mono PCM sine
 * tones, raw for the speak-stream socket and WAV-wrapped for buffered
 * `/api/audio/speak`. Nothing here touches a microphone or a codec.
 */

const TONE_HZ = 440;

export function sinePcm(durationMs: number, sampleRate: number): Uint8Array {
  const frames = Math.max(1, Math.round((sampleRate * durationMs) / 1_000));
  const bytes = new Uint8Array(frames * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < frames; i += 1) {
    const amplitude = Math.sin((2 * Math.PI * TONE_HZ * i) / sampleRate);
    view.setInt16(i * 2, Math.round(amplitude * 0.2 * 0x7fff), true);
  }
  return bytes;
}

export function wavDataUrl(durationMs: number, sampleRate: number): string {
  const pcm = sinePcm(durationMs, sampleRate);
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  const wav = new Uint8Array(header.byteLength + pcm.byteLength);
  wav.set(header, 0);
  wav.set(pcm, header.byteLength);
  return `data:audio/wav;base64,${Buffer.from(wav).toString('base64')}`;
}
