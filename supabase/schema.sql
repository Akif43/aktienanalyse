-- Supabase-Schema für die Aktienanalyse-App.
-- Einspielen: Supabase → SQL Editor → New query → Inhalt einfügen → Run.

-- Zwischenspeicher für KI-Auswertungen und das Tageslimit der KI-Abfragen.
create table if not exists public.kv_cache (
  key        text primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Zugriff nur über den Service-Key (serverseitig). Ohne Richtlinie kann kein anonymer Client
-- und kein eingeloggter Nutzer lesen oder schreiben; der Service-Key umgeht diese Sperre absichtlich.
alter table public.kv_cache enable row level security;

create index if not exists kv_cache_updated_at_idx on public.kv_cache (updated_at);
