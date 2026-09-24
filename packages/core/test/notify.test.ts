import { describe, expect, it } from 'vitest';
import { AdapterError, NtfyNotifier } from '../src';
import { json, mockFetch, text } from './mock-fetch';

describe('NtfyNotifier', () => {
  it('verlangt ein Topic', () => {
    expect(() => new NtfyNotifier({ topic: '' })).toThrow(AdapterError);
  });

  it('sendet per JSON an die Standard-URL, mit Topic, Titel, Text und Klick-Link', async () => {
    const m = mockFetch(text('ok'));
    await new NtfyNotifier({ topic: 'geheimes-thema', fetch: m.fetch, sleep: m.sleep }).send({ title: 'THYAO: Kurs über 300', message: 'Aktueller Kurs: 305,00 TRY', url: 'https://example.com/s/THYAO.IS' });

    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.url).toBe('https://ntfy.sh');
    expect(m.calls[0]!.init?.method).toBe('POST');
    const body = JSON.parse(m.calls[0]!.init!.body as string);
    expect(body).toEqual({ topic: 'geheimes-thema', title: 'THYAO: Kurs über 300', message: 'Aktueller Kurs: 305,00 TRY', click: 'https://example.com/s/THYAO.IS' });
  });

  it('nutzt eine eigene Basis-URL, falls angegeben', async () => {
    const m = mockFetch(text('ok'));
    await new NtfyNotifier({ topic: 't', url: 'https://ntfy.example.com/', fetch: m.fetch, sleep: m.sleep }).send({ title: 'x', message: 'y' });
    expect(m.calls[0]!.url).toBe('https://ntfy.example.com');
  });

  it('wirft bei einer Fehlerantwort', async () => {
    const m = mockFetch(json({ error: 'nope' }, 500));
    await expect(new NtfyNotifier({ topic: 't', fetch: m.fetch, sleep: m.sleep, retries: 0 }).send({ title: 'x', message: 'y' })).rejects.toThrow(AdapterError);
  });
});
