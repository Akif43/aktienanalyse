/** Unterstützte Sprachen der App und der KI-Texte. */
export type Lang = 'de' | 'tr';
export const LANGS: readonly Lang[] = ['de', 'tr'];
export const DEFAULT_LANG: Lang = 'de';

export function isLang(value: unknown): value is Lang {
  return value === 'de' || value === 'tr';
}

type Params = Record<string, string | number>;

/**
 * Sprachunabhängige Systemmeldung (Hinweise zu Daten und Auswertungen). Der Kern erzeugt nur den Code und die Werte,
 * die Oberfläche bzw. der Server setzen daraus den Text in der gewählten Sprache zusammen.
 */
export interface Msg {
  code: MsgCode;
  params?: Params;
}

const CATALOG = {
  // Hinweise zur Datenqualität (Snapshot und Datenquellen)
  gaps: {
    de: '{count} Lücke(n) von mehr als {days} Tagen in den letzten 120 Kerzen: Kennzahlen können verzerrt sein.',
    tr: 'Son 120 mumda {days} günden uzun {count} boşluk var: göstergeler sapabilir.',
  },
  shortHistory200: {
    de: 'Nur {bars} Tageskerzen: SMA/EMA 200 und Golden/Death Cross fehlen.',
    tr: 'Yalnızca {bars} günlük mum var: 200 günlük ortalamalar ve Golden/Death Cross hesaplanamıyor.',
  },
  short52w: {
    de: 'Nur {bars} Tageskerzen: 52-Wochen-Werte beruhen auf kürzerem Zeitraum.',
    tr: 'Yalnızca {bars} günlük mum var: 52 haftalık değerler daha kısa bir döneme dayanıyor.',
  },
  sourceDropped: {
    de: 'Die Datenquelle lieferte {count} unvollständige Kerzen, sie wurden übersprungen.',
    tr: 'Veri kaynağı {count} eksik mum verdi, bunlar atlandı.',
  },
  approximateData: {
    de: 'Tagesdaten der Ausweichquelle: Eröffnungskurs und Volumen sind angenähert.',
    tr: 'Yedek kaynağın günlük verileri: açılış fiyatı ve hacim yaklaşık değerlerdir.',
  },
  fxUnavailable: {
    de: 'Wechselkursdaten (USD/EUR) waren nicht verfügbar.',
    tr: 'Döviz kuru verileri (USD/EUR) alınamadı.',
  },
  // Hinweise zur Auswahl der KI (Handelsplan)
  unknownEntry: {
    de: 'Einstiegs-ID "{id}" existiert nicht und wurde ignoriert.',
    tr: '"{id}" giriş kodu mevcut değil ve yok sayıldı.',
  },
  unknownStop: {
    de: 'Stop-ID "{id}" existiert nicht und wurde ignoriert.',
    tr: '"{id}" zarar durdur kodu mevcut değil ve yok sayıldı.',
  },
  unknownTarget: {
    de: 'Ziel-ID "{id}" existiert nicht und wurde ignoriert.',
    tr: '"{id}" hedef kodu mevcut değil ve yok sayıldı.',
  },
  stopNotBelowEntry: {
    de: 'Stop {stop} liegt nicht unter dem Einstieg {entry} und wurde verworfen.',
    tr: '{stop} zarar durdur seviyesi {entry} girişinin altında olmadığı için atıldı.',
  },
  targetsNotAboveEntry: {
    de: 'Ziele, die nicht über dem Einstiegsbereich liegen, wurden verworfen.',
    tr: 'Giriş bölgesinin üzerinde olmayan hedefler atıldı.',
  },
  // Hinweise zur KI-Auswertung
  guardRemoved: {
    de: '{count} Aussage(n) mit nicht belegten Zahlen wurden entfernt.',
    tr: 'Dayanağı olmayan sayılar içeren {count} ifade kaldırıldı.',
  },
  newsUnknownId: {
    de: '{count} Bewertung(en) mit unbekannter Meldungs-ID wurden ignoriert.',
    tr: 'Bilinmeyen haber kodlu {count} değerlendirme yok sayıldı.',
  },
  newsMissing: {
    de: '{count} Meldung(en) wurden von der KI nicht bewertet.',
    tr: '{count} haber yapay zekâ tarafından değerlendirilmedi.',
  },
  // Hinweise zu Aktualität und Limits
  refreshTooSoon: {
    de: 'Neue Auswertung frühestens in {minutes} Min. möglich.',
    tr: 'Yeni değerlendirme en erken {minutes} dk sonra yapılabilir.',
  },
  dailyLimit: {
    de: 'Tageslimit für KI-Abfragen erreicht ({limit}).',
    tr: 'Günlük yapay zekâ sorgu sınırına ulaşıldı ({limit}).',
  },
  dataRefreshFailed: {
    de: 'Daten konnten nicht aktualisiert werden: {detail}',
    tr: 'Veriler güncellenemedi: {detail}',
  },
  analysisFailed: {
    de: 'Neue Auswertung fehlgeschlagen: {detail}',
    tr: 'Yeni değerlendirme başarısız oldu: {detail}',
  },
} as const;

export type MsgCode = keyof typeof CATALOG;

export function msg(code: MsgCode, params?: Params): Msg {
  return params ? { code, params } : { code };
}

/** Setzt eine Systemmeldung in der gewünschten Sprache zusammen. Unbekannte Platzhalter bleiben sichtbar. */
export function formatMsg(m: Msg, lang: Lang = DEFAULT_LANG): string {
  const entry = CATALOG[m.code];
  const template = entry?.[lang] ?? entry?.[DEFAULT_LANG] ?? m.code;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (m.params && key in m.params ? String(m.params[key]) : whole));
}

/** Für Tests: alle Codes samt Platzhaltern je Sprache. */
export function messageCatalog(): Record<string, Record<Lang, string>> {
  return CATALOG as unknown as Record<string, Record<Lang, string>>;
}
