/** Reproduce a translucent foreground over its former background, opaquely. */
export function compositeOverlay(background: string, overlay: string): string {
  const backgroundColor = parseColor(background);
  const overlayColor = parseColor(overlay);
  if (!backgroundColor || !overlayColor) return overlay;

  const alpha = overlayColor.alpha;
  return `rgb(${Math.round(overlayColor.red * alpha + backgroundColor.red * (1 - alpha))}, ${Math.round(overlayColor.green * alpha + backgroundColor.green * (1 - alpha))}, ${Math.round(overlayColor.blue * alpha + backgroundColor.blue * (1 - alpha))})`;
}

function parseColor(
  color: string,
): { alpha: number; blue: number; green: number; red: number } | undefined {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((character) => character + character)
            .join('')
        : hex;
    if (full.length !== 6 && full.length !== 8) return undefined;
    const red = Number.parseInt(full.slice(0, 2), 16);
    const green = Number.parseInt(full.slice(2, 4), 16);
    const blue = Number.parseInt(full.slice(4, 6), 16);
    const alpha =
      full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1;
    if (Number.isNaN(red + green + blue + alpha)) return undefined;
    return { alpha, blue, green, red };
  }

  const match = color.match(/^rgba?\(([^)]+)\)$/);
  if (!match) return undefined;
  const values = match[1].split(',').map((part) => Number(part.trim()));
  if (values.length < 3 || values.some(Number.isNaN)) return undefined;
  return {
    alpha: values[3] ?? 1,
    blue: values[2],
    green: values[1],
    red: values[0],
  };
}
