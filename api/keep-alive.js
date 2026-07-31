/**
 * Vercel Serverless Function — Keep-Alive-Ping gegen die heartbeat-Tabelle.
 *
 * Zweck: Supabase pausiert Projekte im Free-Tier nach 7 Tagen ohne Aktivitaet.
 * Ein taeglicher Schreibzugriff verhindert das (siehe vercel.json, crons).
 *
 * Laeuft ausschliesslich serverseitig. Der Service-Role-Key steht als
 * Vercel-Environment-Variable OHNE VITE_-Praefix und landet damit niemals im
 * Client-Bundle — Vite inlined nur Variablen mit VITE_-Praefix.
 *
 * Bewusst ohne @supabase/supabase-js: ein einzelner PATCH gegen PostgREST
 * braucht keine Client-Bibliothek.
 *
 * Benoetigte Environment-Variablen (Vercel, Scope "Production"):
 *   SUPABASE_URL                Projekt-URL, z. B. https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   Service-Role-Key (secret, niemals in Git)
 *   CRON_SECRET                 optional, von Vercel Cron als Bearer gesendet
 */

export default async function handler(req, res) {
  // Vercel Cron sendet "Authorization: Bearer <CRON_SECRET>", sofern die
  // Variable gesetzt ist. Ist sie gesetzt, wird sie auch erzwungen — sonst
  // koennte jeder den Endpunkt aufrufen.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return res.status(500).json({
      error: 'missing_env',
      detail: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY muessen gesetzt sein.',
    });
  }

  try {
    // heartbeat hat RLS aktiv und bewusst KEINE Policy. Nur der
    // Service-Role-Key kommt heran, weil er RLS umgeht.
    const response = await fetch(`${url}/rest/v1/heartbeat?id=eq.1`, {
      method: 'PATCH',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        pinged_at: new Date().toISOString(),
        source: 'vercel-cron',
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return res.status(502).json({ error: 'supabase_error', status: response.status, detail });
    }

    const [row] = await response.json();
    return res.status(200).json({ ok: true, pinged_at: row?.pinged_at ?? null });
  } catch (err) {
    return res.status(502).json({ error: 'request_failed', detail: String(err) });
  }
}
