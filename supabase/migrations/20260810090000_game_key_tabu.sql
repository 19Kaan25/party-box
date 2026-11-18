-- ---------------------------------------------------------------------
-- Neues Spiel "Tabu": Enum-Wert fuer lobbies.current_game.
--
-- BEWUSST eine eigene Migration, nur fuer diese eine Zeile -- Begruendung
-- wie in 20260809090000_game_key_activity.sql: ein neuer Enum-Wert darf in
-- derselben Transaktion noch nicht benutzt werden, die naechste Migration
-- (…_legacy_patch_tabu.sql) braucht ihn aber committed.
-- ---------------------------------------------------------------------
alter type public.game_key add value if not exists 'tabu';
