-- =====================================================================
--  ####  TRANSITIONAL — wird in Phase 1 (Imposter) wieder entfernt  ####
--
--  Diese Migration existiert AUSSCHLIESSLICH, damit die fuenf bestehenden
--  Spiele-Engines in Phase 0b unveraendert weiterlaufen koennen, waehrend
--  Auth/Lobby/Presence bereits auf Supabase liegen. Sie bildet die alte
--  Firestore-Schreibform (ein Dokument, Punktpfade, arrayUnion) auf das
--  neue Schema ab.
--
--  Was hier NICHT passiert (bewusst, siehe docs/supabase-migration-plan.md):
--    - keine Trennung der Geheimnisse (player_secrets bleibt ungenutzt)
--    - keine Host-Autorisierung im Spielzustand
--    - keine serverseitige Spiellogik
--  Das ist Aufgabe der Phasen 1-5, Imposter zuerst.
--
--  Abbau in Phase 1: legacy_apply_patch, legacy_resolve_op und
--  lobbies.legacy_state ersatzlos loeschen, sobald alle Engines eigene
--  RPCs haben.
--
--  Referenz: docs/supabase-migration-plan.md §10 (Phasenplan)
-- =====================================================================

-- ---------------------------------------------------------------------
-- TRANSITIONAL: Traeger fuer lobby-weite Felder, fuer die das neue Schema
-- bewusst keine Spalten hat, weil Phase 1 sie ohnehin umbaut.
-- ---------------------------------------------------------------------
alter table public.lobbies
  add column if not exists legacy_state jsonb not null default '{}'::jsonb;

comment on column public.lobbies.legacy_state is
  'TRANSITIONAL (Phase 0b). Traegt ausschliesslich usedImposterWords und
   customImposterWords aus dem alten Firestore-Lobby-Dokument. Wird in
   Phase 1 zusammen mit legacy_apply_patch() entfernt.';

-- ---------------------------------------------------------------------
-- Serverzeit fuer die Uhren-Offset-Messung (Plan §3.1).
-- PostgREST liefert sonst nur den Date-Header mit Sekundenaufloesung --
-- zu grob fuer einen fairen Stadt-Land-Fluss-Timer.
-- Das ist KEIN Uebergangscode: die Funktion bleibt auch nach Phase 1.
-- ---------------------------------------------------------------------
create or replace function public.server_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

revoke all on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated;

-- ---------------------------------------------------------------------
-- TRANSITIONAL: loest das arrayUnion-Sentinel des Shims auf.
-- Der Client sendet {"__op":"arrayUnion","values":[...]}, weil sich
-- Firestores arrayUnion() nicht als reiner JSON-Wert ausdruecken laesst.
-- ---------------------------------------------------------------------
create or replace function public.legacy_resolve_op(p_current jsonb, p_val jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_item   jsonb;
begin
  if jsonb_typeof(p_val) = 'object' and p_val ->> '__op' = 'arrayUnion' then
    v_result := coalesce(p_current, '[]'::jsonb);
    if jsonb_typeof(v_result) <> 'array' then
      v_result := '[]'::jsonb;
    end if;
    for v_item in select * from jsonb_array_elements(p_val -> 'values') loop
      if not (v_result @> jsonb_build_array(v_item)) then
        v_result := v_result || jsonb_build_array(v_item);
      end if;
    end loop;
    return v_result;
  end if;
  return p_val;
end $$;

revoke all on function public.legacy_resolve_op(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- TRANSITIONAL: Kern des Bridge-Layers.
--
-- Nimmt einen Patch in der alten Firestore-Form entgegen und verteilt ihn
-- auf lobbies / lobby_members / games.
--
--   status                    -> lobbies.status (+ games-Lebenszyklus)
--   currentGame               -> lobbies.current_game
--   settings                  -> lobbies.global_leaderboard
--   players[]                 -> lobby_members.score
--   used/customImposterWords  -> lobbies.legacy_state
--   gameState                 -> games.state (ganzes Objekt)
--   gameState.a.b.c           -> jsonb_set auf games.state
--
-- AUTORISIERUNG BEWUSST NUR "aktives Mitglied", NICHT "Host":
-- heute schreiben Nicht-Hosts legitim in den Spielzustand (Imposter-Votes,
-- Stadt-Land-Fluss-Antworten, Codenames-Teamwahl). Eine Host-Pruefung an
-- dieser Stelle wuerde bestehendes Spielverhalten aendern -- das gehoert
-- in die Phasen 1-5, nicht in den Transport.
-- ---------------------------------------------------------------------
create or replace function public.legacy_apply_patch(p_lobby uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := auth.uid();
  v_key           text;
  v_val           jsonb;
  v_game_id       uuid;
  v_game_key      public.game_key;
  v_new_game      public.game_key;
  v_new_status    public.lobby_status;
  v_state         jsonb;
  v_state_dirty   boolean := false;
  v_legacy        jsonb;
  v_legacy_dirty  boolean := false;
  v_path          text[];
  v_prefix        text[];
  v_player        jsonb;
  i               int;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if not public.is_lobby_member(p_lobby) then
    raise exception 'NOT_A_MEMBER';
  end if;

  -- Lobby sperren: serialisiert konkurrierende Patches derselben Runde.
  perform 1 from public.lobbies where id = p_lobby for update;

  -- -------------------------------------------------------------------
  -- Schritt 1: status/currentGame zuerst -- legt die games-Zeile an bzw.
  -- beendet sie. Muss vor den gameState-Keys laufen.
  -- -------------------------------------------------------------------
  if p_patch ? 'status' then
    v_new_status := case p_patch ->> 'status'
                      when 'GAME_IN_PROGRESS' then 'in_progress'
                      else 'waiting'
                    end::public.lobby_status;

    v_new_game := case p_patch ->> 'currentGame'
                    when 'IMPOSTER'          then 'imposter'
                    when 'WERWOLF'           then 'werwolf'
                    when 'CODENAMES'         then 'codenames'
                    when 'WER_BIN_ICH'       then 'wer_bin_ich'
                    when 'STADT_LAND_FLUSS'  then 'stadt_land_fluss'
                    else null
                  end::public.game_key;

    if v_new_status = 'in_progress' then
      select g.id, g.game_key into v_game_id, v_game_key
        from public.games g
       where g.lobby_id = p_lobby and g.ended_at is null;

      if v_new_game is not null then
        if v_game_id is null then
          insert into public.games (lobby_id, game_key, phase, state)
          values (p_lobby, v_new_game,
                  coalesce(p_patch -> 'gameState' ->> 'phase', 'SETUP'), '{}'::jsonb)
          returning id into v_game_id;
        elsif v_game_key <> v_new_game then
          -- Spielwechsel ohne Zwischenstopp in der Lobby: alte Partie sauber
          -- beenden, damit games_one_active_per_lobby nicht verletzt wird.
          update public.games set ended_at = now() where id = v_game_id;
          insert into public.games (lobby_id, game_key, phase, state)
          values (p_lobby, v_new_game,
                  coalesce(p_patch -> 'gameState' ->> 'phase', 'SETUP'), '{}'::jsonb)
          returning id into v_game_id;
        end if;
      end if;

      update public.lobbies
         set status           = 'in_progress',
             current_game     = coalesce(v_new_game, current_game),
             last_activity_at = now()
       where id = p_lobby;
    else
      update public.games
         set ended_at = now()
       where lobby_id = p_lobby and ended_at is null;

      update public.lobbies
         set status           = 'waiting',
             current_game     = null,
             last_activity_at = now()
       where id = p_lobby;

      v_game_id := null;   -- gameState-Keys werden danach ignoriert
    end if;
  else
    select g.id into v_game_id
      from public.games g
     where g.lobby_id = p_lobby and g.ended_at is null;
  end if;

  if v_game_id is not null then
    select g.state into v_state from public.games g where g.id = v_game_id;
  end if;

  select l.legacy_state into v_legacy from public.lobbies l where l.id = p_lobby;

  -- -------------------------------------------------------------------
  -- Schritt 2: restliche Keys. jsonb_each liefert kuerzere Keys zuerst,
  -- also 'gameState' vor 'gameState.phase' -- die gewuenschte Reihenfolge.
  -- -------------------------------------------------------------------
  for v_key, v_val in select * from jsonb_each(p_patch) loop
    if v_key in ('status', 'currentGame') then
      continue;

    elsif v_key = 'settings' then
      update public.lobbies
         set global_leaderboard = coalesce((v_val ->> 'globalLeaderboard')::boolean,
                                           global_leaderboard),
             last_activity_at   = now()
       where id = p_lobby;

    elsif v_key = 'players' then
      -- Punkte aus dem alten players-Array in lobby_members.score spiegeln.
      for v_player in select * from jsonb_array_elements(v_val) loop
        if (v_player ->> 'id') is not null and (v_player ->> 'globalScore') is not null then
          update public.lobby_members
             set score = greatest(0, (v_player ->> 'globalScore')::int)
           where lobby_id = p_lobby
             and user_id  = (v_player ->> 'id')::uuid;
        end if;
      end loop;

    elsif v_key in ('usedImposterWords', 'customImposterWords') then
      v_legacy := jsonb_set(coalesce(v_legacy, '{}'::jsonb), array[v_key],
                            public.legacy_resolve_op(v_legacy -> v_key, v_val), true);
      v_legacy_dirty := true;

    elsif v_key = 'gameState' then
      if v_game_id is not null then
        v_state := public.legacy_resolve_op(v_state, v_val);
        v_state_dirty := true;
      end if;

    elsif v_key like 'gameState.%' then
      if v_game_id is not null then
        v_path  := string_to_array(substring(v_key from 11), '.');
        v_state := coalesce(v_state, '{}'::jsonb);

        -- Zwischenobjekte anlegen: jsonb_set(create_missing) erzeugt nur den
        -- LETZTEN Schluessel, nicht die Zwischenebenen.
        if array_length(v_path, 1) > 1 then
          for i in 1 .. array_length(v_path, 1) - 1 loop
            v_prefix := v_path[1:i];
            if v_state #> v_prefix is null
               or jsonb_typeof(v_state #> v_prefix) <> 'object' then
              v_state := jsonb_set(v_state, v_prefix, '{}'::jsonb, true);
            end if;
          end loop;
        end if;

        v_state := jsonb_set(v_state, v_path,
                             public.legacy_resolve_op(v_state #> v_path, v_val), true);
        v_state_dirty := true;
      end if;
    end if;
  end loop;

  if v_state_dirty then
    update public.games
       set state = v_state,
           phase = coalesce(v_state ->> 'phase', phase)
     where id = v_game_id;
  end if;

  if v_legacy_dirty then
    update public.lobbies set legacy_state = v_legacy where id = p_lobby;
  end if;

  update public.lobbies set last_activity_at = now() where id = p_lobby;
end $$;

revoke all on function public.legacy_apply_patch(uuid, jsonb) from public, anon;
grant execute on function public.legacy_apply_patch(uuid, jsonb) to authenticated;
