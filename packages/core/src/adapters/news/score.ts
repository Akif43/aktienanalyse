import type { Instrument, NewsItem } from '../../types';

/**
 * Grobe Vorbewertung einer Meldung (0 bis 100), bevor die KI sie liest: Wie direkt geht es um diese Firma, und wie viel
 * Wirkung auf den Kurs ist plausibel? Sie entscheidet nur, welche Meldungen zur KI-Auswertung geschickt werden und in welcher
 * Reihenfolge sie erscheinen, solange keine KI-Bewertung vorliegt. Die eigentliche Bewertung macht die KI.
 */

const tr = (s: string) => s.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

const LEGAL_WORDS = new Set(['a', 's', 'ş', 'o', 'ao', 'as', 'aş', 'anonim', 'ortaklığı', 'ortakligi', 'şirketi', 'sirketi', 'inc', 'corp', 'corporation', 'ltd', 'plc', 'se', 'ag', 'holding', 'ticaret', 'sanayi', 've', 'tic', 'san']);

/** Bedeutende Wörter eines Firmennamens (ohne Rechtsform). */
function nameTokens(name: string): string[] {
  return tr(name)
    .split(' ')
    .filter((w) => w.length >= 3 && !LEGAL_WORDS.has(w));
}

/** Kürzel ohne Börsensuffix ("THYAO.IS" → "thyao"). */
const root = (symbol: string) => symbol.split('.')[0]!.toLowerCase();

/** Kurzform aus den Anfangsbuchstaben des Namens ("Türk Hava Yolları" → "thy"), nur bei mindestens drei Wörtern. */
function acronym(name: string): string | null {
  const tokens = nameTokens(name);
  return tokens.length >= 3 ? tokens.map((w) => w[0]).join('') : null;
}

/** Wortstämme (erste 5 Buchstaben), mit denen sich die Firma selbst nennt: Kürzel, Kurzform und Namensteile. */
export function companyStems(instrument: Pick<Instrument, 'symbol' | 'name'>): Set<string> {
  const out = new Set<string>([root(instrument.symbol).slice(0, 5)]);
  if (instrument.name) {
    for (const w of nameTokens(instrument.name)) out.add(w.slice(0, 5));
    const a = acronym(instrument.name);
    if (a) out.add(a);
  }
  return out;
}

/** Kommt die Firma (Name, Kurzform oder Kürzel) im Text vor? */
export function mentionsCompany(text: string, instrument: Pick<Instrument, 'symbol' | 'name'>): boolean {
  const t = ` ${tr(text)} `;
  if (t.includes(` ${root(instrument.symbol)} `)) return true;
  if (!instrument.name) return false;
  const short = acronym(instrument.name);
  if (short && new RegExp(`(^|\\s)${short}(?=\\s|$)`, 'u').test(tr(text))) return true;
  const tokens = nameTokens(instrument.name);
  if (tokens.length === 0) return false;
  // Fast alle Namensteile müssen vorkommen: "Pegasus Hava Yolları" ist nicht "Türk Hava Yolları"
  const hits = tokens.filter((w) => t.includes(` ${w}`)).length;
  return hits >= Math.ceil(tokens.length * 0.7);
}

/** Hat die Firma diese KAP-Meldung selbst veröffentlicht? Ohne Angaben: unbekannt (null). */
export function issuedByCompany(item: NewsItem, instrument: Pick<Instrument, 'name'>): boolean | null {
  if (!item.issuer || !instrument.name) return null;
  const want = nameTokens(instrument.name);
  if (want.length === 0) return null;
  const have = new Set(nameTokens(item.issuer));
  return want.filter((w) => have.has(w)).length / want.length >= 0.5;
}

/** Ereignisse, die den Kurs erfahrungsgemäß bewegen können. */
const IMPACT = [
  'bilanço', 'net kâr', 'net kar', 'net zarar', 'kâr', 'kar açıkla', 'zarar', 'gelir', 'hasılat', 'finansal sonuç', 'faaliyet sonuç', 'çeyrek', 'yıllık sonuç',
  'temettü', 'kâr payı', 'kar payı', 'bedelsiz', 'bedelli', 'sermaye artırım', 'sermaye artir', 'geri alım', 'pay geri',
  'satın al', 'birleşme', 'devralma', 'ortaklık', 'iştirak', 'halka arz', 'ihale', 'sipariş', 'sözleşme', 'anlaşma', 'yatırım', 'ihracat', 'kapasite', 'yeni uçak', 'filo',
  'hedef fiyat', 'tavsiye', 'derecelendirme', 'rating', 'not artır', 'not indir',
  'dava', 'soruşturma', 'ceza', 'yaptırım', 'iflas', 'konkordato', 'yeniden yapılandır', 'temerrüt', 'borç', 'kredi', 'tahvil',
  'genel müdür', 'ceo', 'yönetim kurulu başkan', 'istifa', 'atama',
  'earnings', 'profit', 'dividend', 'acquisition', 'merger', 'lawsuit', 'guidance', 'forecast', 'upgrade', 'downgrade', 'contract',
  'gewinn', 'dividende', 'übernahme', 'klage', 'prognose', 'quartal',
];

/** Sammelmeldungen und Füllstoff ohne echten Bezug zur einzelnen Firma. */
const NOISE = [
  'teknik analiz', 'günün öne çıkan', 'öne çıkan hisse', 'en çok yüksel', 'en çok düş', 'en çok işlem', 'hisse önerisi', 'hisse yorum', 'portföy önerisi',
  'borsa güne', 'borsa günü', 'borsa istanbul günü', 'bist 100 endeks', 'endeksi güne', 'piyasa özeti', 'piyasalarda gün', 'seans', 'canlı borsa',
  'günlük bülten', 'sabah bülteni', 'haftalık', 'hangi hisse', 'hangi hisseler', 'hisseleri', 'burç', 'horoskop',
  'stocks to watch', 'top movers', 'market wrap',
];

/** KAP-Meldungsarten: Formalien bringen selten Kursbewegung, Zahlen und Kapitalmaßnahmen oft. */
const KAP_LOW = ['sorumluluk beyanı', 'bağımsız denetim', 'kurumsal yönetim', 'komite', 'genel kurul', 'işlem yasağı', 'ortaklık yapısı', 'devre kesici', 'tipe dönüşüm', 'temerrüt alışı', 'işlem sırası', 'sürekli işlem', 'yetki belgesi'];
const KAP_HIGH = ['finansal rapor', 'kâr payı', 'kar payı', 'sermaye artırım', 'pay geri alım', 'geri alım', 'birleşme', 'bölünme', 'satın alma', 'ihale', 'sipariş', 'sözleşme', 'iş ilişkisi', 'derecelendirme', 'konkordato', 'yeniden yapılandırma', 'borçlanma', 'tahvil', 'bedelsiz', 'bedelli', 'halka arz'];

const has = (text: string, list: readonly string[]) => list.filter((k) => text.includes(k)).length;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Tickerartige Wörter (mehrere große Kürzel im Titel deuten auf eine Sammelmeldung hin). */
function tickerCount(title: string): number {
  return (title.match(/\b[A-ZÇĞİÖŞÜ]{4,5}\b/g) ?? []).filter((w) => w !== w.toLocaleLowerCase('tr')).length;
}

export function scoreNewsItem(item: NewsItem, instrument: Pick<Instrument, 'symbol' | 'name'>, now: number = Date.now()): number {
  const text = tr(`${item.title} ${item.summary ?? ''} ${item.category ?? ''}`);
  let score = item.kind === 'kap' ? 60 : 40;
  let impactCounts = true;

  if (item.kind === 'kap') {
    const cat = tr(item.category ?? '');
    score += has(`${text} ${cat}`, KAP_HIGH) > 0 ? 20 : 0;
    score -= has(`${text} ${cat}`, KAP_LOW) > 0 ? 25 : 0;
    // Meldung einer anderen Stelle (Börse, Takasbank), in der die Firma nur vorkommt: Ereigniswörter zählen dann nicht
    if (issuedByCompany(item, instrument) === false) {
      score -= 25;
      impactCounts = false;
    }
  } else {
    score += mentionsCompany(item.title, instrument) ? 15 : -10;
    if (tickerCount(item.title) >= 3) score -= 20;
  }
  if (impactCounts) score += Math.min(30, has(text, IMPACT) * 12);
  score -= has(text, NOISE) > 0 ? 30 : 0;

  // Leichte Frische: ältere Meldungen zählen etwas weniger, aber Wirkung schlägt Aktualität
  const ageDays = Math.max(0, (now - item.publishedAt) / 86_400_000);
  score -= Math.min(10, ageDays * 1.5);
  return clamp(score);
}
