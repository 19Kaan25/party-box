-- ---------------------------------------------------------------------
-- Lobby-Einladungen: Ablauf von 2 auf 24 Stunden.
--
-- Neuer Reiter "Einladungen" im Profil-Modal zeigt offene Einladungen
-- dauerhaft an (vorher nur als Toast fuer ein paar Sekunden sichtbar).
-- Bei 2 Stunden Lebensdauer waeren die meisten davon beim naechsten Blick
-- schon wieder weg -- 24 Stunden sind fuer "wird spaeter zur Lobby dazu-
-- stossen" die sinnvollere Grenze.
--
-- Zwei Stellen muessen zusammenpassen:
--   1. list_my_invites() liefert eine abgelaufene Einladung gar nicht erst
--      aus -- massgeblich fuer "ist sie noch offen", unabhaengig davon,
--      wann der stuendliche Job als naechstes laeuft.
--   2. Der Aufraeum-Job loescht die Zeile anschliessend auch wirklich
--      (Datenhygiene, kein unbegrenztes Wachstum der Tabelle).
-- ---------------------------------------------------------------------

create or replace function public.list_my_invites()
returns table (
  id            uuid,
  lobby_code    text,
  from_user     uuid,
  username      text,
  discriminator text,
  display_name  text,
  avatar_path   text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, l.code, i.from_user,
         p.username, p.discriminator, p.display_name, p.avatar_path,
         i.created_at
    from public.lobby_invites i
    join public.lobbies  l on l.id = i.lobby_id
    join public.profiles p on p.id = i.from_user
   where i.to_user = auth.uid()
     and l.closed_at is null
     and i.created_at > now() - interval '24 hours'
   order by i.created_at desc;
$$;

-- cron.schedule() mit demselben Job-Namen ersetzt die bestehende Definition
-- (Schedule + Kommando), legt keinen zweiten Job an.
select cron.schedule(
  'purge-old-invites',
  '7 * * * *',
  $job$
    delete from public.lobby_invites
     where created_at < now() - interval '24 hours';
  $job$
);
