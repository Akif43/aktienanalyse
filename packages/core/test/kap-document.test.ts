import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanKapText, fetchKapDocumentText, kapDisclosureIndex, MAX_KAP_TEXT_CHARS } from '../src/adapters/news/kap-document';
import { fixturePath } from './helpers';
import { mockFetch, text } from './mock-fetch';

const kapItem = { id: 'kap:1666262:MAGEN', kind: 'kap' as const };
const pdfBytes = () => new Uint8Array(readFileSync(fixturePath('kap-geri-alim.pdf')));
const pdfResponse = (bytes: Uint8Array = pdfBytes()) => new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'content-type': 'application/pdf' } });

describe('kapDisclosureIndex', () => {
  it('liest die Meldungsnummer aus der ID, nur bei KAP-Meldungen', () => {
    expect(kapDisclosureIndex(kapItem)).toBe(1666262);
    expect(kapDisclosureIndex({ id: 'kap:1666262:MAGEN', kind: 'news' })).toBeNull();
    expect(kapDisclosureIndex({ id: 'gn:abc', kind: 'news' })).toBeNull();
    expect(kapDisclosureIndex({ id: 'kap:../../etc:X', kind: 'kap' })).toBeNull();
    expect(kapDisclosureIndex({ id: 'kap:12:X', kind: 'kap' })).toBeNull();
  });
});

describe('cleanKapText', () => {
  it('entfernt Formular-Metadaten vor dem Inhalt, Zeitstempel und Links und normalisiert Leerraum', () => {
    const raw = "Titel FIRMA KAMUYU AYDINLATMA PLATFORMU KAP'ta yayınlanma tarihi ve saati: 21.09.2026 18:18:11 https://www.kap.org.tr/tr/Bildirim/1 Yapılan Açıklama Güncelleme mi? Hayır Bildirim İçeriği   Açıklamalar\n Şirketimiz yeni bir sözleşme imzalamıştır.";
    const out = cleanKapText(raw);
    expect(out).toBe('Açıklamalar Şirketimiz yeni bir sözleşme imzalamıştır.');
    expect(out).not.toMatch(/https?:|Güncelleme mi/);
  });

  it('behält bei Formularen ohne "Bildirim İçeriği" den ganzen Text', () => {
    expect(cleanKapText('Geri Alım Programı 1.000.000 adet')).toBe('Geri Alım Programı 1.000.000 adet');
  });

  it('kürzt lange Texte an einer Wortgrenze und kennzeichnet es', () => {
    const long = 'Kelime '.repeat(3000);
    const out = cleanKapText(long, 500);
    expect(out.length).toBeLessThanOrEqual(501);
    expect(out.endsWith('…')).toBe(true);
    expect(cleanKapText(long).length).toBeLessThanOrEqual(MAX_KAP_TEXT_CHARS + 1);
  });
});

describe('fetchKapDocumentText', () => {
  it('holt das PDF von der festen KAP-Adresse und liefert den Text (echte KAP-Datei, echte Textextraktion)', async () => {
    const mock = mockFetch(pdfResponse());
    const out = await fetchKapDocumentText(kapItem, { fetch: mock.fetch, sleep: mock.sleep });
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]!.url).toBe('https://www.kap.org.tr/tr/api/BildirimPdf/1666262');
    expect(out).toMatch(/Geri Alım/);
    expect(out!.length).toBeGreaterThan(200);
    expect(out!.length).toBeLessThanOrEqual(MAX_KAP_TEXT_CHARS + 1);
  });

  it('ruft für Presse-Meldungen und fremde IDs gar nichts ab', async () => {
    const mock = mockFetch(pdfResponse());
    expect(await fetchKapDocumentText({ id: 'gn:abc', kind: 'news' }, { fetch: mock.fetch })).toBeNull();
    expect(await fetchKapDocumentText({ id: 'kap:x:Y', kind: 'kap' }, { fetch: mock.fetch })).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });

  it('liefert null statt eines Fehlers, wenn KAP nicht antwortet, das PDF fehlt, kaputt oder zu groß ist', async () => {
    const opts = (m: ReturnType<typeof mockFetch>) => ({ fetch: m.fetch, sleep: m.sleep, retries: 0 });
    expect(await fetchKapDocumentText(kapItem, opts(mockFetch(text('nicht gefunden', 404))))).toBeNull();
    expect(await fetchKapDocumentText(kapItem, opts(mockFetch(text('boom', 500))))).toBeNull();
    expect(await fetchKapDocumentText(kapItem, opts(mockFetch(text('kein pdf', 200))))).toBeNull();
    expect(await fetchKapDocumentText(kapItem, opts(mockFetch(new Response('x', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } }))))).toBeNull();
  });

  it('liefert null, wenn das PDF praktisch keinen Text enthält', async () => {
    const mock = mockFetch(pdfResponse());
    expect(await fetchKapDocumentText(kapItem, { fetch: mock.fetch, extract: async () => '  Bildirim İçeriği ' })).toBeNull();
  });
});
