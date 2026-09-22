import { useState } from 'react';
import { useT } from '../lib/i18n';

/** Heutiges Datum als "YYYY-MM-DD" (lokale Zeit), Standardwert für das Datumsfeld. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Formular für einen Kauf: Stückzahl, Preis je Stück (in der Landeswährung) und Datum. */
export function LotForm({ currency, onSubmit, onCancel }: { currency: string; onSubmit: (lot: { quantity: number; price: number; date: number }) => void; onCancel?: () => void }) {
  const { t } = useT();
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(today);

  const q = Number(quantity.replace(',', '.'));
  const p = Number(price.replace(',', '.'));
  const valid = quantity.trim() !== '' && price.trim() !== '' && Number.isFinite(q) && q > 0 && Number.isFinite(p) && p >= 0 && date !== '';

  const submit = () => {
    if (!valid) return;
    const ms = new Date(`${date}T12:00:00`).getTime();
    onSubmit({ quantity: q, price: p, date: Number.isFinite(ms) ? ms : Date.now() });
    setQuantity('');
    setPrice('');
    setDate(today());
  };

  return (
    <div className="lot-form">
      <div className="lot-form-row">
        <label className="lot-form-field">
          <span className="row-hint">{t('lot.quantity')}</span>
          <input className="search-input" inputMode="decimal" type="text" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
        </label>
        <label className="lot-form-field">
          <span className="row-hint">{t('lot.price', { currency })}</span>
          <input className="search-input" inputMode="decimal" type="text" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
        </label>
      </div>
      <label className="lot-form-field">
        <span className="row-hint">{t('lot.date')}</span>
        <input className="search-input" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="stack">
        <button type="button" className="btn" onClick={submit} disabled={!valid}>
          {t('lot.add')}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
