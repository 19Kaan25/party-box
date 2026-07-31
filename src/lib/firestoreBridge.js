/* =====================================================================
 *  ####  TRANSITIONAL — wird in Phase 1 (Imposter) entfernt  ####
 *
 *  Firestore-kompatibler Shim. Existiert AUSSCHLIESSLICH, damit die fuenf
 *  bestehenden Spiele-Engines in Phase 0b unveraendert weiterlaufen,
 *  waehrend Auth/Lobby/Presence bereits auf Supabase liegen.
 *
 *  Warum ueberhaupt ein Shim: die Engines schreiben an 35 Stellen direkt
 *  per updateDoc(doc(db, 'lobbies', code), {...}) -- nicht nur ueber die
 *  durchgereichte updateLobbyStatus-Funktion. Mit identischer Signatur
 *  aendert sich in jeder Engine nur die Import-Zeile.
 *
 *  Was hier NICHT passiert (bewusst, siehe docs/supabase-migration-plan.md):
 *    - keine Trennung der Geheimnisse
 *    - keine Host-Autorisierung
 *    - keine serverseitige Spiellogik
 *  Das ist Aufgabe der Phasen 1-5, Imposter zuerst.
 *
 *  Abbau in Phase 1: diese Datei loeschen, sobald jede Engine eigene RPCs
 *  aufruft. Serverseitiges Gegenstueck:
 *  supabase/migrations/20260730220000_phase0b_legacy_bridge.sql
 * ===================================================================== */

import { supabase } from './supabase';

// Vom Lobby-Hook gepflegt: der Shim kennt nur den Lobby-Code aus
// doc(db, 'lobbies', code) und braucht die UUID fuer die RPC.
let activeLobby = { id: null, code: null };

export function setActiveLobby(lobby) {
    activeLobby = lobby ? { id: lobby.id, code: lobby.code } : { id: null, code: null };
}

/** Platzhalter fuer das frueher durchgereichte Firestore-Handle. */
export const db = { __bridge: true };

/** Signatur-kompatibel zu Firestores doc(db, collection, id). */
export function doc(_db, collection, id) {
    return { collection, id };
}

/**
 * Signatur-kompatibel zu Firestores arrayUnion(...values).
 * Wird als Sentinel serialisiert und serverseitig in legacy_resolve_op()
 * aufgeloest -- als reiner JSON-Wert laesst sich die Operation nicht
 * ausdruecken.
 */
export function arrayUnion(...values) {
    return { __op: 'arrayUnion', values };
}

/**
 * Signatur-kompatibel zu Firestores updateDoc(ref, patch).
 * Reicht den Patch unveraendert an legacy_apply_patch weiter, das ihn auf
 * lobbies / lobby_members / games verteilt.
 */
export async function updateDoc(ref, patch) {
    if (!ref || ref.collection !== 'lobbies') {
        throw new Error(`firestoreBridge: unerwartete Collection "${ref?.collection}"`);
    }
    if (!activeLobby.id) {
        throw new Error('firestoreBridge: keine aktive Lobby gesetzt');
    }
    // Der Shim schreibt immer in die aktive Lobby. Die Engines sprechen
    // ohnehin nur ihre eigene an (ref.id === activeLobby.code).
    const { error } = await supabase.rpc('legacy_apply_patch', {
        p_lobby: activeLobby.id,
        p_patch: patch,
    });
    if (error) throw error;
}
