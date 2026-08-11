/**
 * The drawer is conversation chrome, not app-wide navigation. Keep its edge
 * gesture on chat entry screens and off every pushed utility or modal route.
 */
export function isChatDrawerRoute(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 1) return segments[0] === 'new';

  return segments.length === 2 && segments[0] === 'conversation';
}
