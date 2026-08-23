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

export function setWaveSessionTitleInPages(
  data: InfiniteData<WaveSessionPage> | undefined,
  sessionId: string,
  title: string,
): InfiniteData<WaveSessionPage> | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const sessions = page.sessions.map((session) => {
      if (session.id !== sessionId || session.title === title) return session;
      changed = true;
      pageChanged = true;
      return { ...session, title };
    });
    return pageChanged ? { ...page, sessions } : page;
  });
  return changed ? { ...data, pages } : data;
}

export function setWaveSessionUnreadInPages(
  data: InfiniteData<WaveSessionPage> | undefined,
  sessionId: string,
  unread: boolean,
): InfiniteData<WaveSessionPage> | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const sessions = page.sessions.map((session) => {
      if (session.id !== sessionId || session.unread === unread) return session;
      changed = true;
      pageChanged = true;
      return { ...session, unread };
    });
    return pageChanged ? { ...page, sessions } : page;
  });
  return changed ? { ...data, pages } : data;
}

/** The unread flag the list reports for one conversation, if it is loaded. */
export function waveSessionUnreadInPages(
  data: InfiniteData<WaveSessionPage> | undefined,
  sessionId: string,
): { lastActiveAt?: string; unread: boolean } | undefined {
  for (const page of data?.pages ?? []) {
    for (const session of page.sessions) {
      if (session.id === sessionId) {
        return {
          ...(session.lastActiveAt
            ? { lastActiveAt: session.lastActiveAt }
            : {}),
          unread: session.unread,
        };
      }
    }
  }
  return undefined;
}
