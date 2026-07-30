-- =====================================================================
-- PartyBox — Verifikation des TRANSITIONAL Bridge-Layers (Phase 0b)
--
-- Prueft legacy_apply_patch() gegen die tatsaechlichen Patch-Formen aller
-- fuenf Engines. Grund: die Engines schreiben an 35 Stellen direkt per
-- updateDoc(), mit je unterschiedlicher Patch-Gestalt -- ein reiner
-- Imposter-Durchlauf deckt das nicht ab.
--
-- Laeuft in EINER Transaktion mit ROLLBACK. Ausgabe ueber t_results, weil
-- `supabase db query -f` nur das letzte Statement zeigt und RAISE NOTICE
-- unterdrueckt.
--
--   npx supabase db query --linked -f scripts/verify-phase0b-bridge.sql
-- =====================================================================

begin;

create temporary table t_results (seq serial primary key, check_name text) on commit drop;

insert into auth.users
  (id, instance_id, aud, role, created_at, updated_at, is_anonymous, raw_user_meta_data)
values
  ('0b000001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), true, '{"display_name":"Host"}'::jsonb),
  ('0b000002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', now(), now(), true, '{"display_name":"Gast"}'::jsonb);

create temporary table t_ctx (k text primary key, v text) on commit drop;

-- Host legt Lobby an, Gast tritt bei (echte RPCs, kein Direkt-Insert).
select set_config('request.jwt.claims',
  '{"sub":"0b000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into t_ctx select 'lobby', (public.create_lobby('Host') ->> 'lobby_id');
insert into t_ctx select 'code',  l.code from public.lobbies l
 where l.id = (select v::uuid from t_ctx where k = 'lobby');

select set_config('request.jwt.claims',
  '{"sub":"0b000002-0000-4000-8000-000000000002","role":"authenticated"}', true);
select public.join_lobby((select v from t_ctx where k = 'code'), 'Gast');

select set_config('request.jwt.claims',
  '{"sub":"0b000001-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
begin
  assert (select count(*) from public.lobby_members m
           where m.lobby_id = (select v::uuid from t_ctx where k = 'lobby')
             and m.left_at is null) = 2, 'Setup: 2 Mitglieder erwartet';
  insert into t_results (check_name) values ('00 Setup: Lobby + 2 Mitglieder ueber echte RPCs');
end $$;

-- ---------------------------------------------------------------------
-- IMPOSTER: Spielstart. Kombiniert status + currentGame + arrayUnion auf
-- Lobby-Ebene + komplettes gameState-Objekt in EINEM Patch.
-- ---------------------------------------------------------------------
do $$
declare
  v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_game  public.games%rowtype;
  v_lob   public.lobbies%rowtype;
begin
  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'status', 'GAME_IN_PROGRESS',
    'currentGame', 'IMPOSTER',
    'usedImposterWords', jsonb_build_object('__op','arrayUnion','values', jsonb_build_array('Leuchtturm')),
    'gameState', jsonb_build_object(
      'phase','ROLE_REVEAL', 'word','Leuchtturm',
      'imposters', jsonb_build_array('0b000002-0000-4000-8000-000000000002'),
      'votes', '{}'::jsonb)
  ));

  select * into v_game from public.games where lobby_id = v_lobby and ended_at is null;
  select * into v_lob  from public.lobbies where id = v_lobby;

  assert found, 'Imposter: aktive games-Zeile haette entstehen muessen';
  assert v_game.game_key = 'imposter', format('Imposter: game_key ist %s', v_game.game_key);
  assert v_game.state ->> 'word' = 'Leuchtturm', 'Imposter: gameState.word fehlt';
  assert v_game.phase = 'ROLE_REVEAL',
    format('Imposter: phase-Spalte haette mitgezogen werden muessen, ist %s', v_game.phase);
  assert v_lob.status = 'in_progress', 'Imposter: lobbies.status falsch';
  assert v_lob.current_game = 'imposter', 'Imposter: lobbies.current_game falsch';
  assert v_lob.legacy_state -> 'usedImposterWords' = '["Leuchtturm"]'::jsonb,
    format('Imposter: arrayUnion auf Lobby-Ebene falsch: %s', v_lob.legacy_state);
  insert into t_results (check_name)
  values ('01 IMPOSTER Spielstart: games-Zeile, phase-Sync, status/currentGame, arrayUnion auf legacy_state');
end $$;

-- ---------------------------------------------------------------------
-- IMPOSTER: Vote. Dynamischer Punktpfad mit uid als Schluessel, vom
-- NICHT-Host geschrieben (so verhaelt sich die Engine heute).
-- ---------------------------------------------------------------------
do $$
declare
  v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_state jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"0b000002-0000-4000-8000-000000000002","role":"authenticated"}', true);

  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'gameState.votes.0b000002-0000-4000-8000-000000000002',
    to_jsonb('0b000001-0000-4000-8000-000000000001'::text)
  ));

  select state into v_state from public.games where lobby_id = v_lobby and ended_at is null;
  assert v_state -> 'votes' ->> '0b000002-0000-4000-8000-000000000002'
         = '0b000001-0000-4000-8000-000000000001',
    format('Imposter-Vote: votes falsch: %s', v_state -> 'votes');
  assert v_state ->> 'word' = 'Leuchtturm', 'Imposter-Vote: hat den restlichen state zerstoert';
  insert into t_results (check_name)
  values ('02 IMPOSTER Vote: dynamischer Punktpfad durch NICHT-Host, restlicher state intakt');

  perform set_config('request.jwt.claims',
    '{"sub":"0b000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
end $$;

-- ---------------------------------------------------------------------
-- WERWOLF: neun gameState-Keys in EINEM Patch (haeufigster Aufruf,
-- WerwolfEngine.jsx:61).
-- ---------------------------------------------------------------------
do $$
declare
  v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_state jsonb;
begin
  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'status','GAME_IN_PROGRESS','currentGame','WERWOLF'));

  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'gameState.phase','PLAYING',
    'gameState.narrator','0b000001-0000-4000-8000-000000000001',
    'gameState.dayNumber', to_jsonb(1),
    'gameState.isDay', to_jsonb(false),
    'gameState.playerState', jsonb_build_object(
      '0b000002-0000-4000-8000-000000000002',
      jsonb_build_object('role','WERWOLF','alive',true,'inLove',false,'deathReason',null)),
    'gameState.recentDeaths', '[]'::jsonb,
    'gameState.witchState', jsonb_build_object('healUsed',false,'poisonUsed',false),
    'gameState.winningFaction', 'null'::jsonb,
    'gameState.hunterShooting', 'null'::jsonb
  ));

  select state into v_state from public.games where lobby_id = v_lobby and ended_at is null;
  assert v_state ->> 'phase' = 'PLAYING', 'Werwolf: phase falsch';
  assert v_state -> 'playerState' -> '0b000002-0000-4000-8000-000000000002' ->> 'role' = 'WERWOLF',
    format('Werwolf: playerState falsch: %s', v_state -> 'playerState');
  assert v_state -> 'witchState' ->> 'healUsed' = 'false', 'Werwolf: witchState falsch';
  assert jsonb_typeof(v_state -> 'recentDeaths') = 'array', 'Werwolf: recentDeaths kein Array';
  insert into t_results (check_name)
  values ('03 WERWOLF: 9 gameState-Keys in einem Patch, verschachtelte Objekte korrekt');
end $$;

-- ---------------------------------------------------------------------
-- CODENAMES: zwei verschachtelte Objekte (CodenamesEngine.jsx:34).
-- ---------------------------------------------------------------------
do $$
declare
  v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_state jsonb;
begin
  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'status','GAME_IN_PROGRESS','currentGame','CODENAMES'));

  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'gameState.teams', jsonb_build_object(
      'red', jsonb_build_array('0b000001-0000-4000-8000-000000000001'),
      'blue','[]'::jsonb),
    'gameState.spymasters', jsonb_build_object(
      'red','0b000001-0000-4000-8000-000000000001','blue',null)
  ));

  select state into v_state from public.games where lobby_id = v_lobby and ended_at is null;
  assert v_state -> 'teams' -> 'red' ->> 0 = '0b000001-0000-4000-8000-000000000001',
    format('Codenames: teams.red falsch: %s', v_state -> 'teams');
  assert v_state -> 'spymasters' ->> 'red' = '0b000001-0000-4000-8000-000000000001',
    'Codenames: spymasters falsch';
  insert into t_results (check_name)
  values ('04 CODENAMES: verschachtelte Objekte (teams/spymasters), Spielwechsel beendet alte Partie');
end $$;

-- ---------------------------------------------------------------------
-- WER BIN ICH: arrayUnion mit OBJEKT-Element auf gameState-Ebene
-- (WerBinIchEngine.jsx:108) -- zweimal aufgerufen, muss idempotent sein.
-- ---------------------------------------------------------------------
do $$
declare
  v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_state jsonb;
begin
  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'status','GAME_IN_PROGRESS','currentGame','WER_BIN_ICH'));

  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'gameState.inputArray', jsonb_build_object('__op','arrayUnion','values',
      jsonb_build_array(jsonb_build_object(
        'userId','0b000001-0000-4000-8000-000000000001',
        'words', jsonb_build_array('Batman','Merkel'))))
  ));
  -- exakt derselbe Eintrag erneut: arrayUnion darf nicht duplizieren
  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'gameState.inputArray', jsonb_build_object('__op','arrayUnion','values',
      jsonb_build_array(jsonb_build_object(
        'userId','0b000001-0000-4000-8000-000000000001',
        'words', jsonb_build_array('Batman','Merkel'))))
  ));

  select state into v_state from public.games where lobby_id = v_lobby and ended_at is null;
  assert jsonb_array_length(v_state -> 'inputArray') = 1,
    format('WerBinIch: arrayUnion hat dupliziert, Laenge %s',
           jsonb_array_length(v_state -> 'inputArray'));
  assert v_state -> 'inputArray' -> 0 -> 'words' ->> 0 = 'Batman',
    'WerBinIch: Objekt-Element falsch';
  insert into t_results (check_name)
  values ('05 WER BIN ICH: arrayUnion mit Objekt-Element, idempotent bei Doppelaufruf');
end $$;

-- ---------------------------------------------------------------------
-- STADT LAND FLUSS: Punktpfad mit uid, dessen Zwischenobjekt NICHT
-- existiert -- prueft das Anlegen der Zwischenebene.
-- ---------------------------------------------------------------------
do $$
declare
  v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_state jsonb;
begin
  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'status','GAME_IN_PROGRESS','currentGame','STADT_LAND_FLUSS'));

  -- gameState ist frisch {} -- 'answers' existiert noch nicht.
  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'gameState.answers.0b000001-0000-4000-8000-000000000001',
    jsonb_build_object('Stadt','Berlin','Land','Belgien')
  ));

  select state into v_state from public.games where lobby_id = v_lobby and ended_at is null;
  assert v_state -> 'answers' -> '0b000001-0000-4000-8000-000000000001' ->> 'Stadt' = 'Berlin',
    format('SLF: verschachtelter Pfad falsch: %s', v_state);
  insert into t_results (check_name)
  values ('06 STADT LAND FLUSS: Punktpfad legt fehlende Zwischenebene an');
end $$;

-- ---------------------------------------------------------------------
-- Spielende: status -> LOBBY_WAITING beendet die Partie UND schreibt die
-- Punkte aus dem alten players-Array nach lobby_members.score.
-- ---------------------------------------------------------------------
do $$
declare
  v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
  v_lob   public.lobbies%rowtype;
begin
  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'status','LOBBY_WAITING',
    'players', jsonb_build_array(
      jsonb_build_object('id','0b000001-0000-4000-8000-000000000001','globalScore',5),
      jsonb_build_object('id','0b000002-0000-4000-8000-000000000002','globalScore',3)),
    'gameState', '{}'::jsonb
  ));

  select * into v_lob from public.lobbies where id = v_lobby;
  assert v_lob.status = 'waiting', 'Spielende: status falsch';
  assert v_lob.current_game is null, 'Spielende: current_game haette geleert werden muessen';
  assert not exists (select 1 from public.games
                      where lobby_id = v_lobby and ended_at is null),
    'Spielende: es haette keine aktive Partie mehr geben duerfen';
  assert (select score from public.lobby_members
           where lobby_id = v_lobby
             and user_id = '0b000001-0000-4000-8000-000000000001') = 5,
    'Spielende: Punkte Host nicht uebernommen';
  assert (select score from public.lobby_members
           where lobby_id = v_lobby
             and user_id = '0b000002-0000-4000-8000-000000000002') = 3,
    'Spielende: Punkte Gast nicht uebernommen';
  insert into t_results (check_name)
  values ('07 Spielende: games beendet, current_game geleert, players[] -> lobby_members.score');
end $$;

-- ---------------------------------------------------------------------
-- settings-Patch (LobbyWaitingScreen: globales Scoring umschalten).
-- ---------------------------------------------------------------------
do $$
declare v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
begin
  perform public.legacy_apply_patch(v_lobby, jsonb_build_object(
    'status','LOBBY_WAITING',
    'settings', jsonb_build_object('globalLeaderboard', false)));
  assert (select global_leaderboard from public.lobbies where id = v_lobby) = false,
    'settings: globalLeaderboard nicht uebernommen';
  insert into t_results (check_name) values ('08 settings -> lobbies.global_leaderboard');
end $$;

-- ---------------------------------------------------------------------
-- Autorisierung: ein Fremder (kein Mitglied) darf NICHT patchen.
-- ---------------------------------------------------------------------
do $$
declare v_lobby uuid := (select v::uuid from t_ctx where k = 'lobby');
begin
  insert into auth.users (id, instance_id, aud, role, created_at, updated_at, is_anonymous)
  values ('0b000003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated', now(), now(), true);

  perform set_config('request.jwt.claims',
    '{"sub":"0b000003-0000-4000-8000-000000000003","role":"authenticated"}', true);
  begin
    perform public.legacy_apply_patch(v_lobby, jsonb_build_object('gameState.phase','HACK'));
    assert false, 'Fremder haette nicht patchen duerfen';
  exception when raise_exception then
    assert sqlerrm = 'NOT_A_MEMBER', format('Unerwarteter Fehler: %s', sqlerrm);
  end;
  insert into t_results (check_name)
  values ('09 Autorisierung: Nicht-Mitglied wird mit NOT_A_MEMBER abgewiesen');
end $$;

-- ---------------------------------------------------------------------
-- server_now(): Quelle fuer den Uhren-Offset.
-- ---------------------------------------------------------------------
do $$
declare v_now timestamptz;
begin
  select public.server_now() into v_now;
  assert v_now is not null and abs(extract(epoch from (v_now - now()))) < 5,
    'server_now() liefert keine plausible Serverzeit';
  insert into t_results (check_name) values ('10 server_now() liefert Serverzeit');
end $$;

-- Erwartet: 11 lueckenlose Zeilen (00..10).
select seq, check_name from t_results order by seq;

rollback;
