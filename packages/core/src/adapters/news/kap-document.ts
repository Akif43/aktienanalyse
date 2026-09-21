import { extractText, getDocumentProxy } from 'unpdf';
import { request, type HttpOptions } from '../../http';
import type { NewsItem } from '../../types';

const ID = 'kap';
const BASE = 'https://www.kap.org.tr';
/** KAP-Formulare sind klein (meist unter 200 KB). Alles darüber ist ein Anhang oder ein Fehler. */
const MAX_BYTES = 4 * 1024 * 1024;
/** So viel Text bekommt die KI höchstens (spart Kontingent, wichtige Angaben stehen vorn). */
export const MAX_KAP_TEXT_CHARS = 7000;

/** Meldungsnummer bei KAP aus unserer Meldungs-ID ("kap:1666268:GLRYH" → 1666268). Nur KAP-Meldungen haben eine. */
export function kapDisclosureIndex(item: Pick<NewsItem, 'id' | 'kind'>): number | null {
  if (item.kind !== 'kap') return null;
  const m = /^kap:(\d{3,9}):/.exec(item.id);
  return m ? Number(m[1]) : null;
}

/**
 * Bereinigt den aus dem KAP-PDF gelesenen Text: Leerraum, Kopfzeilen des Formulars und die Formular-Metadaten
 * ("Güncelleme mi?" …) entfallen, der eigentliche Inhalt ab "Bildirim İçeriği" bleibt. Sehr lange Texte werden gekürzt.
 */
export function cleanKapText(raw: string, max = MAX_KAP_TEXT_CHARS): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  text = text.replace(/KAP'ta yayınlanma tarihi ve saati:\s*[\d.: ]+/g, '').replace(/https?:\/\/\S+/g, '');
  const start = text.indexOf('Bildirim İçeriği');
  if (start > 0) text = text.slice(start + 'Bildirim İçeriği'.length);
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 200))}…`;
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export interface KapDocumentOptions extends HttpOptions {
  /** Austauschbar für Tests. Standard: PDF-Text mit unpdf. */
  extract?: (bytes: Uint8Array) => Promise<string>;
}

/**
 * Lädt den Volltext einer KAP-Meldung (das offizielle PDF der Meldung) und liefert ihn bereinigt.
 * Nur die feste KAP-Adresse mit einer numerischen Meldungsnummer wird abgerufen. `null`, wenn der Text nicht
 * verfügbar ist (Meldung ohne Nummer, Fehler, zu groß, leer): Die Auswertung stützt sich dann auf Überschrift und Kurztext.
 */
export async function fetchKapDocumentText(item: Pick<NewsItem, 'id' | 'kind'>, opts: KapDocumentOptions = {}): Promise<string | null> {
  const index = kapDisclosureIndex(item);
  if (index === null) return null;
  try {
    const res = await request(
      `${BASE}/tr/api/BildirimPdf/${index}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'tr-TR,tr;q=0.9', Referer: `${BASE}/tr/Bildirim/${index}` } },
      ID,
      { retries: 1, timeoutMs: 12_000, ...opts },
    );
    if (!res.ok) return null;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
    const text = cleanKapText(await (opts.extract ?? pdfToText)(bytes));
    return text.length >= 20 ? text : null;
  } catch {
    return null;
  }
}
