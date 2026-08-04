import type { InfiniteData } from '@tanstack/react-query';

import type { WaveSessionPage } from '../../services/wave/wave-chat-client.ts';

export function nextWaveSessionPageOffset(
  page: WaveSessionPage,
): number | undefined {
  return page.hasMore ? page.offset + page.limit : undefined;
}

export function setWaveSessionPinnedInPages(
  data: InfiniteData<WaveSessionPage> | undefined,
  sessionId: string,
  pinned: boolean,
): InfiniteData<WaveSessionPage> | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const sessions = page.sessions.map((session) => {
      if (session.id !== sessionId || session.pinned === pinned) return session;
      changed = true;
      pageChanged = true;
      return { ...session, pinned };
    });
    return pageChanged ? { ...page, sessions } : page;
  });
  return changed ? { ...data, pages } : data;
}
