// functions/_lib/auth.js
// Shared session + creator checks for the Pages Functions.
// (No onRequest* exports, so Pages does not route this file.)

export const CLEAR_SESSION_COOKIE = [
    'adam_session=',
    'Path=/',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
].join('; ');

export function getSessionToken(request) {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/(?:^|;\s*)adam_session=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

export function serviceHeaders(env, extra = {}) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    return { 'apikey': key, 'Authorization': `Bearer ${key}`, ...extra };
}

// Returns the Supabase user for a session token, or null if the token is
// missing/invalid. Network errors propagate so callers can tell them apart.
export async function getUser(env, token) {
    if (!token || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY }
    });
    return res.ok ? res.json() : null;
}

// Creator = the email stored in settings.creator_email (case-insensitive).
export async function isCreator(env, user) {
    const email = user?.email?.toLowerCase();
    if (!email) return false;
    const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/settings?key=eq.creator_email&select=value`,
        { headers: serviceHeaders(env) }
    );
    if (!res.ok) return false;
    const settings = await res.json();
    const creatorEmail = settings[0]?.value?.toLowerCase();
    return !!creatorEmail && email === creatorEmail;
}

export function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
