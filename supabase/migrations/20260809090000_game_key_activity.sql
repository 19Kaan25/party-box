-- ---------------------------------------------------------------------
-- Neues Spiel "Activity": Enum-Wert fuer lobbies.current_game.
--
-- BEWUSST eine eigene Migration, nur fuer diese eine Zeile -- Begruendung
-- wie in 20260805090000_game_key_sprueche_klopfer.sql: ein neuer Enum-Wert
-- darf in derselben Transaktion noch nicht benutzt werden, die naechste
-- Migration (…_legacy_patch_activity.sql) braucht ihn aber committed.
-- ---------------------------------------------------------------------
alter type public.game_key add value if not exists 'activity';
