import { useState, type ReactNode } from 'react';
import { appStorage } from '../lib/storage';

/**
 * Ein-/ausklappbarer Bereich. Der Inhalt wird erst beim Aufklappen erzeugt (spart Abfragen), der Zustand bleibt
 * über `storageKey` auf dem Gerät erhalten.
 */
export function Collapsible({ title, subtitle, storageKey, children }: { title: string; subtitle?: string; storageKey?: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => {
    try {
      return storageKey ? appStorage.getItem(storageKey) === '1' : false;
    } catch {
      return false;
    }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      if (storageKey) appStorage.setItem(storageKey, next ? '1' : '0');
    } catch {
      /* Persistenz ist optional */
    }
  };

  return (
    <section className={`collapsible ${open ? 'collapsible-open' : ''}`}>
      <button type="button" className="collapsible-head" aria-expanded={open} onClick={toggle}>
        <span>
          <span className="collapsible-title">{title}</span>
          {subtitle && <span className="collapsible-sub">{subtitle}</span>}
        </span>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="chevron">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  );
}
