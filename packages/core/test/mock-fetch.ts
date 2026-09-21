import type { FetchLike } from '../src/http';

export type Reply = Response | ((url: string, init?: RequestInit) => Response | Promise<Response>);

export interface MockFetch {
  fetch: FetchLike;
  calls: { url: string; init?: RequestInit }[];
  sleeps: number[];
  sleep: (ms: number) => Promise<void>;
}

export function json(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function text(body: string, status = 200): Response {
  return new Response(body, { status });
}

/** Spielt Antworten der Reihe nach ab. Die letzte Antwort wird bei weiteren Aufrufen wiederholt. */
export function mockFetch(...replies: Reply[]): MockFetch {
  const calls: MockFetch['calls'] = [];
  const sleeps: number[] = [];
  let i = 0;
  return {
    calls,
    sleeps,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      const reply = replies[Math.min(i++, replies.length - 1)]!;
      // Response-Bodies sind einmalig lesbar: bei Wiederholung klonen.
      if (typeof reply === 'function') return reply(url, init);
      return reply.clone();
    },
  };
}
