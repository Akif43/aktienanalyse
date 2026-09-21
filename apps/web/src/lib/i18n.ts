import { DEFAULT_LANG, formatMsg, isLang, type Lang, type Msg } from '@aktien/core';
import { useSyncExternalStore } from 'react';
import { de, type DictKey } from './dict-de';
import { tr } from './dict-tr';
import { appStorage, LANG_KEY } from './storage';

export type { DictKey, Lang };

const DICTS: Record<Lang, Record<DictKey, string>> = { de, tr };

/** Sprache aus der Handy-Einstellung: Türkisch, wenn das Gerät auf Türkisch steht, sonst Deutsch. */
export function detectLang(languages: readonly string[] = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])): Lang {
  for (const l of languages) {
    const code = String(l).toLowerCase();
    if (code.startsWith('tr')) return 'tr';
    if (code.startsWith('de')) return 'de';
  }
  return DEFAULT_LANG;
}

function initialLang(): Lang {
  const stored = appStorage.getItem(LANG_KEY);
  return isLang(stored) ? stored : detectLang();
}

let active: Lang = initialLang();
const listeners = new Set<() => void>();

export const getLang = (): Lang => active;
export const localeOf = (lang: Lang = active): string => (lang === 'tr' ? 'tr-TR' : 'de-DE');

/** Ersetzt {name} in einem Text. Unbekannte Platzhalter bleiben sichtbar. */
function fill(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));
}

export function translate(key: DictKey, params?: Record<string, string | number>, lang: Lang = active): string {
  return fill(DICTS[lang][key] ?? DICTS[DEFAULT_LANG][key] ?? key, params);
}

/** Übersetzt einen Schlüssel, der zur Laufzeit gebildet wird (z. B. "trend.aufwärts"). Fehlt er, kommt `fallback` zurück. */
export function translateDynamic(key: string, fallback: string, params?: Record<string, string | number>, lang: Lang = active): string {
  const text = (DICTS[lang] as Record<string, string>)[key];
  return text === undefined ? fallback : fill(text, params);
}

function applyToDocument(lang: Lang): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.title = translate('app.name', undefined, lang);
}

export function setLang(lang: Lang): void {
  if (lang === active) return;
  active = lang;
  try {
    appStorage.setItem(LANG_KEY, lang);
  } catch {
    /* Persistenz ist optional */
  }
  applyToDocument(lang);
  listeners.forEach((l) => l());
}

applyToDocument(active);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** Übersetzungsfunktionen für Komponenten. Ein Sprachwechsel rendert alle Nutzer neu. */
export function useT() {
  const lang = useLang();
  return {
    lang,
    t: (key: DictKey, params?: Record<string, string | number>) => translate(key, params, lang),
    /** Systemmeldung des Kerns (Datenhinweise, Notizen) in der gewählten Sprache. */
    msg: (m: Msg) => formatMsg(m, lang),
    dynamic: (key: string, fallback: string, params?: Record<string, string | number>) => translateDynamic(key, fallback, params, lang),
  };
}

export const LANG_OPTIONS: readonly { value: Lang; label: string }[] = [
  { value: 'de', label: 'Deutsch' },
  { value: 'tr', label: 'Türkçe' },
];
