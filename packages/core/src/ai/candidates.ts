import type { TechnicalSnapshot } from '../indicators/snapshot';
import { msg, type Msg } from '../messages';
import type { Zone } from '../indicators/structure';
import { round } from '../indicators/series';

export type CandidateKind = 'entry' | 'stop' | 'target';

/** Art des Kandidaten, damit die Oberfläche die Beschriftung in der gewählten Sprache selbst bilden kann. */
export type CandidateCode =
  | 'entry_now'
  | 'entry_pullback'
  | 'entry_breakout'
  | 'stop_atr'
  | 'stop_support'
  | 'stop_breakout'
  | 'target_zone'
  | 'target_high52'
  | 'target_atr2'
  | 'target_atr4'
  | 'target_atr_high52';

/**
 * Ein vom Programm berechneter Kurswert oder -bereich. Die KI wählt Kandidaten über ihre ID und erfindet
 * keine eigenen Kurse. Einstieg und Stop gelten für eine Kaufposition (Aktien ohne Leerverkauf).
 */
export interface Candidate {
  id: string;
  kind: CandidateKind;
  /** Deutsche Beschriftung (für die KI). Die App bildet die Anzeige aus `code` und `zoneId`. */
  label: string;
  code: CandidateCode;
  /** Zone, auf die sich der Kandidat bezieht (z. B. "S1"), falls vorhanden. */
  zoneId?: string;
  /** Unter- und Obergrenze (bei einem einzelnen Kurs identisch). */
  low: number;
  high: number;
  /** Abstand der Mitte zum aktuellen Kurs in Prozent (positiv = darüber). */
  distancePercent: number;
  /** Wie der Wert entstanden ist, für die Begründung der KI. */
  basis: string;
}

export interface Candidates {
  entries: Candidate[];
  stops: Candidate[];
  targets: Candidate[];
}

const digitsFor = (price: number) => (price < 1 ? 4 : 2);

/** Berechnet Einstiegs-, Stop- und Zielkandidaten aus Zonen und ATR. Ohne ATR gibt es keine Kandidaten. */
export function buildCandidates(snapshot: TechnicalSnapshot): Candidates {
  const price = snapshot.price;
  const atr = snapshot.atr14.value;
  const out: Candidates = { entries: [], stops: [], targets: [] };
  if (atr === null || atr <= 0) return out;

  const d = digitsFor(price);
  const make = (id: string, kind: CandidateKind, code: CandidateCode, label: string, low: number, high: number, basis: string, zoneId?: string): Candidate => {
    const lo = round(Math.min(low, high), d)!;
    const hi = round(Math.max(low, high), d)!;
    const mid = (lo + hi) / 2;
    return { id, kind, code, label, ...(zoneId ? { zoneId } : {}), low: lo, high: hi, distancePercent: round(((mid - price) / price) * 100, 2)!, basis };
  };

  const supports: Zone[] = snapshot.levels.supports;
  const resistances: Zone[] = snapshot.levels.resistances;
  const s1 = supports[0];
  const r1 = resistances[0];

  // Einstiegsbereiche
  out.entries.push(make('E1', 'entry', 'entry_now', 'Aktueller Kursbereich', price - 0.25 * atr, price + 0.25 * atr, 'Kurs ± 0,25 × ATR'));
  if (s1) out.entries.push(make('E2', 'entry', 'entry_pullback', `Rücksetzer in Unterstützungszone ${s1.id}`, s1.low, s1.high, `Zone ${s1.id} (${s1.touches} Berührungen)`, s1.id));
  if (r1) out.entries.push(make('E3', 'entry', 'entry_breakout', `Ausbruch über Widerstandszone ${r1.id}`, r1.high, r1.high + 0.25 * atr, `Kurs über Oberkante von ${r1.id} (Bestätigung durch Schlusskurs nötig)`, r1.id));

  // Stop-Loss-Bereiche (jeweils unterhalb des Einstiegs)
  out.stops.push(make('SL1', 'stop', 'stop_atr', 'Stop 2 × ATR unter dem Kurs', price - 2 * atr, price - 2 * atr, 'Kurs − 2 × ATR'));
  if (s1) out.stops.push(make('SL2', 'stop', 'stop_support', `Stop unter Unterstützungszone ${s1.id}`, s1.low - 0.5 * atr, s1.low - 0.5 * atr, `Unterkante von ${s1.id} − 0,5 × ATR`, s1.id));
  if (supports[1]) out.stops.push(make('SL3', 'stop', 'stop_support', `Stop unter Unterstützungszone ${supports[1].id}`, supports[1].low - 0.5 * atr, supports[1].low - 0.5 * atr, `Unterkante von ${supports[1].id} − 0,5 × ATR`, supports[1].id));
  if (r1) out.stops.push(make('SL4', 'stop', 'stop_breakout', `Stop unter dem ausgebrochenen Widerstand ${r1.id}`, r1.low - 0.5 * atr, r1.low - 0.5 * atr, `Unterkante von ${r1.id} − 0,5 × ATR (passt zu Ausbruch E3)`, r1.id));

  // Kursziele: Unterkanten der Widerstandszonen (vorsichtig) und das 52-Wochen-Hoch, auch wenn es nur einmal berührt wurde
  // (eine Zone braucht mindestens 2 Berührungen). Ohne beides: ATR-Projektionen.
  const points: { value: number; code: CandidateCode; label: string; basis: string; zoneId?: string }[] = resistances
    .slice(0, 3)
    .map((z) => ({ value: z.low, code: 'target_zone' as const, label: `Widerstandszone ${z.id} (Unterkante)`, basis: `Unterkante von ${z.id} (${z.touches} Berührungen)`, zoneId: z.id }));
  const high52 = snapshot.range52w?.high ?? null;
  const coveredByZone = high52 !== null && resistances.some((z) => high52 >= z.low - 0.5 * atr && high52 <= z.high + 0.5 * atr);
  const hasHigh52Target = high52 !== null && high52 > price + 0.25 * atr && !coveredByZone;
  if (hasHigh52Target) points.push({ value: high52, code: 'target_high52', label: '52-Wochen-Hoch', basis: '52-Wochen-Hoch (Ausbruch darüber wäre ein neues Jahreshoch)' });
  points.sort((a, b) => a.value - b.value);
  points.forEach((p, i) => out.targets.push(make(`T${i + 1}`, 'target', p.code, p.label, p.value, p.value, p.basis, p.zoneId)));

  if (out.targets.length === 0) {
    out.targets.push(make('T1', 'target', 'target_atr2', 'ATR-Projektion 2 ×', price + 2 * atr, price + 2 * atr, 'Kurs + 2 × ATR (kein Widerstand im Datenzeitraum)'));
    out.targets.push(make('T2', 'target', 'target_atr4', 'ATR-Projektion 4 ×', price + 4 * atr, price + 4 * atr, 'Kurs + 4 × ATR (kein Widerstand im Datenzeitraum)'));
  } else if (hasHigh52Target && out.targets.length === 1) {
    // Nur das Jahreshoch als Hindernis: ein weiteres Ziel darüber als Ausbruchsprojektion
    out.targets.push(make('T2', 'target', 'target_atr_high52', 'ATR-Projektion über dem 52-Wochen-Hoch', high52! + 2 * atr, high52! + 2 * atr, '52-Wochen-Hoch + 2 × ATR (nur nach Ausbruch über das Jahreshoch)'));
  }
  return out;
}

export interface ResolvedPlan {
  entry: Candidate | null;
  stop: Candidate | null;
  targets: Candidate[];
  /** Chance-Risiko-Verhältnis: (erstes Ziel − Einstieg) / (Einstieg − Stop), nur wenn stimmig berechenbar. */
  riskReward: number | null;
  /** Hinweise, wenn die Auswahl der KI nicht stimmig war und Teile verworfen wurden. */
  notes: Msg[];
}

/**
 * Wandelt die von der KI gewählten IDs in Zahlen um und prüft die Stimmigkeit: unbekannte IDs entfallen,
 * der Stop muss unter dem Einstieg liegen, Ziele über dem Einstieg (aufsteigend sortiert).
 */
export function resolvePlan(
  candidates: Candidates,
  choice: { entryId: string | null; stopId: string | null; targetIds: string[] },
): ResolvedPlan {
  const notes: Msg[] = [];
  const find = (list: Candidate[], id: string | null, what: 'unknownEntry' | 'unknownStop' | 'unknownTarget'): Candidate | null => {
    if (!id) return null;
    const c = list.find((x) => x.id === id);
    if (!c) notes.push(msg(what, { id }));
    return c ?? null;
  };

  const entry = find(candidates.entries, choice.entryId, 'unknownEntry');
  let stop = find(candidates.stops, choice.stopId, 'unknownStop');
  const seen = new Set<string>();
  let targets = choice.targetIds
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
    .map((id) => find(candidates.targets, id, 'unknownTarget'))
    .filter((c): c is Candidate => c !== null);

  if (entry && stop && stop.low >= entry.low) {
    notes.push(msg('stopNotBelowEntry', { stop: stop.id, entry: entry.id }));
    stop = null;
  }
  if (entry) {
    const before = targets.length;
    targets = targets.filter((t) => t.low > entry.high);
    if (targets.length < before) notes.push(msg('targetsNotAboveEntry'));
  }
  targets.sort((a, b) => a.low - b.low);

  let riskReward: number | null = null;
  if (entry && stop && targets[0]) {
    const mid = (entry.low + entry.high) / 2;
    const risk = mid - stop.low;
    const reward = targets[0].low - mid;
    if (risk > 0 && reward > 0) riskReward = round(reward / risk, 2);
  }
  return { entry, stop, targets, riskReward, notes };
}
