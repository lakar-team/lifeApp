// functions/api/admin/register-app.js
// Server-side app registration endpoint (Creator only)
// Uses the service role key so RLS doesn't block writes

import { getSessionToken, getUser, isCreator, serviceHeaders, json } from '../../_lib/auth.js';

// Returns an error Response if the caller isn't the creator, otherwise null.
async function requireCreator(request, env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        return json({ error: 'Server configuration missing' }, 500);
    }

    const accessToken = getSessionToken(request);
    if (!accessToken) {
        return json({ error: 'Auth token missing' }, 401);
    }

    try {
        const user = await getUser(env, accessToken);
        if (!user) {
            return json({ error: 'Session validation failed' }, 401);
        }
        if (!(await isCreator(env, user))) {
            return json({ error: 'Unauthorized: Not the Creator' }, 403);
        }
    } catch (err) {
        return json({ error: 'Server authentication error', details: err.message }, 500);
    }
    return null;
}

export async function onRequestPost(context) {
    const { request, env } = context;

    // 1. Verify caller is the creator
    const denied = await requireCreator(request, env);
    if (denied) return denied;

    // 2. Parse the app data from request body
    let appData;
    try {
        appData = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    // 3. Upsert the app using the service role key (bypasses RLS)
    const upsertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/apps`, {
        method: 'POST',
        headers: serviceHeaders(env, {
            'Content-Type': 'application/json',
            'Prefer': 'return=representation,resolution=merge-duplicates'
        }),
        body: JSON.stringify(appData)
    });

    if (!upsertRes.ok) {
        const errText = await upsertRes.text();
        return json({ error: 'Database error', details: errText }, 500);
    }

    const result = await upsertRes.json();
    return json({ success: true, app: result });
}

// Also support PATCH for updates and DELETE for removal
export async function onRequestPatch(context) {
    return handleModify(context, 'PATCH');
}

export async function onRequestDelete(context) {
    return handleModify(context, 'DELETE');
}

async function handleModify(context, method) {
    const { request, env } = context;

    const denied = await requireCreator(request, env);
    if (denied) return denied;

    // Get app ID from query string
    const url = new URL(request.url);
    const appId = url.searchParams.get('id');
    if (!appId) {
        return json({ error: 'Missing app id' }, 400);
    }

    let body = undefined;
    if (method === 'PATCH') {
        try {
            body = JSON.stringify(await request.json());
        } catch {
            return json({ error: 'Invalid JSON body' }, 400);
        }
    }

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/apps?id=eq.${encodeURIComponent(appId)}`, {
        method,
        headers: serviceHeaders(env, { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
        body
    });

    if (!res.ok) {
        const errText = await res.text();
        return json({ error: 'Database error', details: errText }, 500);
    }

    return json({ success: true });
}
