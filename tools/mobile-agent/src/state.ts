const MAX_ALLOWED_DEPTH = 20;
const MAX_ALLOWED_BYTES = 256 * 1024;

export interface SanitizedState {
  value: unknown;
  byteLength: number;
  redactedKeys: number;
  depthLimited: boolean;
}

export function sanitizeState(
  value: unknown,
  options: { maxDepth?: number; maxBytes?: number } = {},
): SanitizedState {
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 8, 1), MAX_ALLOWED_DEPTH);
  const maxBytes = Math.min(Math.max(options.maxBytes ?? 32 * 1024, 1_024), MAX_ALLOWED_BYTES);
  let redactedKeys = 0;
  let depthLimited = false;

  const visit = (current: unknown, depth: number): unknown => {
    if (depth > maxDepth) {
      depthLimited = true;
      return '[MAX_DEPTH]';
    }
    if (Array.isArray(current)) return current.map((item) => visit(item, depth + 1));
    if (!current || typeof current !== 'object') return current;
    return Object.fromEntries(
      Object.entries(current).map(([key, nested]) => {
        if (isSensitiveStateKey(key)) {
          redactedKeys += 1;
          return [key, '[REDACTED]'];
        }
        return [key, visit(nested, depth + 1)];
      }),
    );
  };

  const sanitized = visit(value, 0);
  const serialized = JSON.stringify(sanitized);
  if (serialized === undefined) {
    throw new Error('The state provider returned a value that is not JSON serializable.');
  }
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength > maxBytes) {
    throw new Error(`Sanitized state is ${byteLength} bytes, exceeding the ${maxBytes}-byte limit.`);
  }
  return {
    value: sanitized,
    byteLength,
    redactedKeys,
    depthLimited,
  };
}

export function isSensitiveStateKey(key: string): boolean {
  return /(authorization|cookie|token|secret|password|passwd|api[-_]?key|signature|access[-_]?key|refresh[-_]?token)/i.test(
    key,
  );
}
