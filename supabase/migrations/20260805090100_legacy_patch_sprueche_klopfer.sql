-- ---------------------------------------------------------------------
-- legacy_apply_patch: 'SPRUECHE_KLOPFER' auf den neuen Enum-Wert mappen.
--
-- Unveraendert aus 20260730220000_phase0b_legacy_bridge.sql uebernommen,
-- ergaenzt ist ausschliesslich die eine when-Zeile in v_new_game. Die
-- Funktion bleibt TRANSITIONAL und faellt mit den Phasen 1-5 weg.
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
                    when 'SPRUECHE_KLOPFER'  then 'sprueche_klopfer'
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
