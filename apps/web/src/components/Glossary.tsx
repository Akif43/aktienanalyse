import { useT, type DictKey } from '../lib/i18n';

const TERMS: readonly DictKey[] = ['gloss.sma', 'gloss.rsi', 'gloss.macd', 'gloss.bollinger', 'gloss.atr', 'gloss.support', 'gloss.cross', 'gloss.stop', 'gloss.volume'];

/** Kleines Wörterbuch für die Fachbegriffe im Bereich für Fortgeschrittene. */
export function Glossary() {
  const { t } = useT();
  return (
    <section className="group glossary">
      <h3>{t('gloss.title')}</h3>
      <ul className="plain">
        {TERMS.map((key) => {
          // Jeder Eintrag lautet "Begriff: Erklärung": der Begriff wird hervorgehoben
          const text = t(key);
          const i = text.indexOf(':');
          return (
            <li key={key}>
              {i > 0 ? (
                <>
                  <strong>{text.slice(0, i)}</strong>
                  {text.slice(i)}
                </>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
