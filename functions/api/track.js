// functions/api/track.js
// Records a client-side usage event (share / heartbeat / close) for the
// signed-in user. Launches are logged server-side by _middleware.js, so they
// are not accepted here. The user is taken from the session cookie, never
// from the request body.

import { getSessionToken, getUser, serviceHeaders, json } from '../_lib/auth.js';

const ALLOWED_ACTIONS = new Set(['share', 'heartbeat', 'close']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestPost(context) {
    const { request, env } = context;

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const { appId, action } = body || {};
    if (!ALLOWED_ACTIONS.has(action) || typeof appId !== 'string' || !UUID_RE.test(appId)) {
        return json({ error: 'Invalid event' }, 400);
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        return json({ error: 'Server configuration missing' }, 500);
    }

    let user;
    try {
        user = await getUser(env, getSessionToken(request));
    } catch (err) {
        console.error('Tracking auth error:', err.message);
        return json({ error: 'Auth check failed' }, 502);
    }
    if (!user?.id) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/usage_logs`, {
        method: 'POST',
        headers: serviceHeaders(env, { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
        body: JSON.stringify({
            app_id: appId,
            action,
            user_id: user.id,
            ip: request.headers.get('cf-connecting-ip')
        })
    });

    if (!res.ok) {
        console.error('Tracking DB error:', res.status, await res.text());
        return json({ error: 'Failed to record event' }, 500);
    }

    return json({ success: true });
}
