/**
 * Zahlen-Wächter: stellt sicher, dass die KI keine Zahlen erfindet. Jede Zahl in einem Text der KI muss
 * (gerundet oder abgeschnitten) im JSON vorkommen, das wir ihr gegeben haben. Sätze mit nicht belegten
 * Zahlen werden entfernt.
 *
 * Bewusst freigegeben (kein Kurs- oder Kennzahlenbezug): kleine ganze Zahlen 0–10 (außer direkt vor einer
 * Währung), gängige Indikator-Perioden (12/26/9, 14, 20, 50, 200, 52 …), RSI-Schwellen 30/70 und Jahreszahlen.
 */

export interface NumberMention {
  raw: string;
  /** Mögliche Lesarten ("1,234" kann 1,234 oder 1234 bedeuten) mit Nachkommastellen. */
  readings: { value: number; decimals: number }[];
  /** true, wenn direkt eine Währung folgt (dann gilt keine Freigabe für kleine Zahlen). */
  isPrice: boolean;
}

const FREE_INTS = new Set([9, 12, 14, 20, 26, 30, 50, 52, 70, 100, 200]);
const DATE_RE = /\b\d{1,2}\.\d{1,2}\.(?:\d{2,4})?(?!\d)/g;
const TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const NUM_RE = /(?<![\p{L}\d_.,])\d+(?:[.,]\d+)*(?![\p{L}\d_])/gu;
const CURRENCY_AFTER = /^\s{0,2}(?:₺|\$|€|TRY|USD|EUR|Lira|Dollar|Euro)/i;

/** Alle Lesarten eines Zahlentokens ("1.234,5", "1,234.5", "3,5", "1.234" …). */
export function readings(token: string): { value: number; decimals: number }[] {
  const out: { value: number; decimals: number }[] = [];
  const add = (intPart: string, frac = '') => {
    const v = Number(`${intPart}${frac ? `.${frac}` : ''}`);
    if (Number.isFinite(v)) out.push({ value: v, decimals: frac.length });
  };
  const hasDot = token.includes('.');
  const hasComma = token.includes(',');

  if (hasDot && hasComma) {
    const decimalSep = token.lastIndexOf('.') > token.lastIndexOf(',') ? '.' : ',';
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    const [i, f] = token.split(decimalSep);
    add(i!.split(thousandsSep).join(''), f);
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = token.split(sep);
    if (parts.length > 2) {
      add(parts.join('')); // 1.234.567 → Tausendertrenner
    } else {
      const [i, f] = parts as [string, string];
      add(i, f); // Dezimaltrenner
      if (f.length === 3 && i.length <= 3 && i !== '0') add(i + f); // "1.234" kann auch 1234 sein
    }
  } else {
    add(token);
  }
  return out;
}

/** Findet alle Zahlen in einem Text (Datum und Uhrzeit werden vorher ausgeblendet). */
export function extractNumbers(text: string): NumberMention[] {
  const cleaned = text.replace(DATE_RE, ' ').replace(TIME_RE, ' ');
  const out: NumberMention[] = [];
  for (const m of cleaned.matchAll(NUM_RE)) {
    const raw = m[0];
    const after = cleaned.slice(m.index! + raw.length, m.index! + raw.length + 12);
    out.push({ raw, readings: readings(raw), isPrice: CURRENCY_AFTER.test(after) });
  }
  return out;
}

/** Alle Zahlen aus einem JSON: numerische Werte (auch als Betrag) und Zahlen in Textfeldern (Überschriften usw.). */
export function collectAllowedNumbers(payload: unknown): number[] {
  const out = new Set<number>();
  const visit = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.add(v);
      out.add(Math.abs(v));
    } else if (typeof v === 'string') {
      for (const n of extractNumbers(v)) for (const r of n.readings) out.add(r.value);
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(visit);
    }
  };
  visit(payload);
  return [...out];
}

const EPS = 1e-9;
function roundTo(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round((x + Math.sign(x) * EPS) * f) / f;
}
function truncTo(x: number, d: number): number {
  const f = 10 ** d;
  return Math.trunc((x + Math.sign(x) * EPS) * f) / f;
}

/** Stimmt die genannte Zahl mit einer erlaubten überein (als Rundung oder Abschneiden auf die genannten Stellen)? */
export function isSupported(mention: NumberMention, allowed: readonly number[]): boolean {
  for (const { value, decimals } of mention.readings) {
    const isInt = decimals === 0 && Number.isInteger(value);
    if (isInt && !mention.isPrice && value >= 0 && value <= 10) return true;
    if (isInt && !mention.isPrice && FREE_INTS.has(value)) return true;
    if (isInt && value >= 1990 && value <= 2100) return true;
    for (const b of allowed) {
      if (Math.abs(value - roundTo(b, decimals)) < EPS || Math.abs(value - truncTo(b, decimals)) < EPS) return true;
    }
  }
  return false;
}

export function findUnsupported(text: string, allowed: readonly number[]): string[] {
  return extractNumbers(text)
    .filter((n) => !isSupported(n, allowed))
    .map((n) => n.raw);
}

const ABBREVIATIONS = /\b(z\. ?B|d\. ?h|u\. ?a|s\. ?o|ca|bzw|Nr|Mio|Mrd|ggf|vgl|inkl|evtl|etc|Std|Min|max|mind)\./gi;
const DOT_MASK = '\u0001';

/**
 * Trennt in Sätze. Bekannte Abkürzungen ("z. B.", "ca.", "Mio.") und Zahlen nach einem Punkt beenden keinen Satz.
 * Im Zweifel bleiben Sätze zusammen: das entfernt bei einer ungültigen Zahl lieber etwas mehr als zu wenig.
 */
export function splitSentences(text: string): string[] {
  const masked = text.replace(ABBREVIATIONS, (m) => m.replace(/\./g, DOT_MASK));
  return masked
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/)
    .map((s) => s.split(DOT_MASK).join('.').trim())
    .filter(Boolean);
}

export interface SanitizedText {
  text: string;
  removedSentences: number;
  unsupported: string[];
}

/** Entfernt Sätze, die nicht belegte Zahlen enthalten. */
export function sanitizeText(text: string, allowed: readonly number[]): SanitizedText {
  const kept: string[] = [];
  const unsupported: string[] = [];
  let removed = 0;
  for (const s of splitSentences(text)) {
    const bad = findUnsupported(s, allowed);
    if (bad.length) {
      removed++;
      unsupported.push(...bad);
    } else kept.push(s);
  }
  return { text: kept.join(' '), removedSentences: removed, unsupported };
}

export interface GuardReport {
  /** Anzahl entfernter Sätze bzw. Listeneinträge. */
  removed: number;
  /** Die nicht belegten Zahlen (für die Wiederholungsanfrage und Diagnose). */
  unsupported: string[];
}

/** Felder, die keine Freitexte sind (IDs, feste Auswahlwerte). */
const SKIP_KEYS = new Set(['id', 'candidateId', 'verdict', 'confidence', 'sentiment', 'horizon', 'relevance']);

/** Prüft alle Textfelder eines KI-Ergebnisses und entfernt Sätze mit nicht belegten Zahlen. */
export function guardValue<T>(value: T, allowed: readonly number[], report: GuardReport = { removed: 0, unsupported: [] }): { value: T; report: GuardReport } {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') {
      if (key && SKIP_KEYS.has(key)) return v;
      const r = sanitizeText(v, allowed);
      report.removed += r.removedSentences;
      report.unsupported.push(...r.unsupported);
      return r.text;
    }
    if (Array.isArray(v)) {
      const mapped = v.map((x) => walk(x, key));
      // Textlisten: leere Einträge (komplett entfernte Sätze) fallen weg
      return mapped.filter((x) => !(typeof x === 'string' && x === ''));
    }
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    }
    return v;
  };
  return { value: walk(value) as T, report };
}

/** Nur prüfen, ohne zu verändern: Liste aller nicht belegten Zahlen. */
export function scanUnsupported(value: unknown, allowed: readonly number[]): string[] {
  const found: string[] = [];
  const walk = (v: unknown, key?: string) => {
    if (typeof v === 'string') {
      if (!(key && SKIP_KEYS.has(key))) found.push(...findUnsupported(v, allowed));
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(value);
  return found;
}
