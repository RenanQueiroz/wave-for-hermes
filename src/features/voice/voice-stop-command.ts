const STOP_PHRASES = [
  'stop',
  'stop listening',
  'stop wave',
  'wave stop',
  'cancel',
  'never mind',
  'nevermind',
  'exit voice',
  'end voice',
  'quiet',
];

/**
 * True only for a whole-utterance command to leave voice mode. A phrase that
 * merely contains a stop word remains ordinary user intent.
 */
export function isVoiceStopCommand(transcript: string): boolean {
  const normalized = transcript
    .toLowerCase()
    .replace(/[.!?,;:]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return STOP_PHRASES.includes(normalized);
}
