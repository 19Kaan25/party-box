import webpush from 'web-push';

/**
 * Vercel Serverless Function — verschickt eine Web-Push-Benachrichtigung
 * fuer eine Lobby-Einladung an einen Freund, der gerade nicht online ist.
 *
 * Laeuft ausschliesslich serverseitig, genau wie api/keep-alive.js. Der
 * Service-Role-Key und der private VAPID-Schluessel stehen als
 * Vercel-Environment-Variablen OHNE VITE_-Praefix und landen damit nie im
 * Client-Bundle.
 *
 * Zwei Hosts, ein Endpunkt: PartyBox laeuft parallel auf Vercel und Firebase
 * Hosting (s. CLAUDE.md "Hosting"), aber Vercel Functions gibt es nur bei
 * Vercel -- der Client auf der Firebase-URL ruft diesen Endpunkt deshalb
 * ueber die volle Vercel-URL auf (VITE_API_BASE_URL), was ihn zu einer
 * Cross-Origin-Anfrage macht. Daher die CORS-Behandlung unten.
 *
 * Sicherheit: NICHT die Origin entscheidet, ob gesendet wird (CORS ist nur
 * eine Browser-Bremse, kein Schutz gegen direkte Aufrufe). Massgeblich ist,
 * dass (a) der Access-Token echt ist -- geprueft ueber /auth/v1/user -- und
 * (b) fuer genau dieses Aufrufer/Ziel-Paar eine lobby_invites-Zeile
 * existiert. Wer keine Einladung ausgesprochen hat, kann so niemandem eine
 * Push-Nachricht unterschieben.
 *
 * Benoetigte Environment-Variablen (Vercel, Scope "Production"):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   wie keep-alive.js
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY       node -e "console.log(require('web-push').generateVAPIDKeys())"
 */

const ALLOWED_ORIGINS = [
  'https://party-box-45d2b.web.app',
  'http://localhost:5173',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Vercel selbst: Preview-Deployments haben wechselnde Subdomains, die
  // Produktions-URL ist hier nicht fest bekannt -- *.vercel.app reicht als
  // Filter, da CORS wie oben beschrieben nicht die eigentliche Schranke ist.
  try {
    return new URL(origin).hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

const MAX_MESSAGE_LENGTH = 140;

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return res.status(500).json({
      error: 'missing_env',
      detail: 'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY muessen gesetzt sein.',
    });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'unauthorized', detail: 'Kein Access-Token.' });
  }

  const { toUserId, lobbyCode, message } = req.body || {};
  if (!toUserId || !lobbyCode) {
    return res.status(400).json({ error: 'bad_request', detail: 'toUserId und lobbyCode sind Pflicht.' });
  }

  // 1. Token verifizieren, echte Nutzer-ID des Aufrufers ermitteln --
  //    niemals der ID vertrauen, die der Client mitschickt.
  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${token}` },
  });
  if (!userResp.ok) {
    return res.status(401).json({ error: 'unauthorized', detail: 'Token ungueltig oder abgelaufen.' });
  }
  const { id: fromUserId } = await userResp.json();

  // 2. Es muss tatsaechlich eine offene Einladung von genau diesem Aufrufer
  //    an genau dieses Ziel geben -- die eigentliche Autorisierung.
  const inviteResp = await fetch(
    `${supabaseUrl}/rest/v1/lobby_invites?from_user=eq.${fromUserId}&to_user=eq.${toUserId}&select=id&limit=1`,
    { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
  );
  const invites = inviteResp.ok ? await inviteResp.json() : [];
  if (invites.length === 0) {
    return res.status(403).json({ error: 'no_pending_invite' });
  }

  // 3. Push-Abos des Ziel-Nutzers holen.
  const subsResp = await fetch(
    `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${toUserId}&select=endpoint,p256dh,auth`,
    { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
  );
  if (!subsResp.ok) {
    return res.status(502).json({ error: 'supabase_error', detail: await subsResp.text() });
  }
  const subscriptions = await subsResp.json();
  if (subscriptions.length === 0) {
    return res.status(200).json({ sent: 0, removed: 0, detail: 'no_subscription' });
  }

  webpush.setVapidDetails('mailto:kaan.koeten@gmx.de', vapidPublicKey, vapidPrivateKey);

  const body = (message || '').trim().slice(0, MAX_MESSAGE_LENGTH)
    || `Du wurdest in eine Lobby eingeladen (${lobbyCode}).`;
  const payload = JSON.stringify({
    title: 'PartyBox — Neue Einladung',
    body,
    url: '/',
  });

  let sent = 0;
  let removed = 0;
  const deadEndpoints = [];

  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      sent += 1;
    } catch (err) {
      // 404/410: der Push-Dienst kennt dieses Abo nicht mehr (Browser-Reset,
      // Berechtigung entzogen, Geraet abgemeldet) -- aufraeumen statt bei
      // jeder weiteren Einladung erneut zu scheitern.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        deadEndpoints.push(sub.endpoint);
      }
    }
  }));

  if (deadEndpoints.length > 0) {
    await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?endpoint=in.(${deadEndpoints.map((e) => `"${e}"`).join(',')})`, {
      method: 'DELETE',
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    }).catch(() => {});
    removed = deadEndpoints.length;
  }

  return res.status(200).json({ sent, removed });
}
