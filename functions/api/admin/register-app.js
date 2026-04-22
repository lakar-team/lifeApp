// functions/api/admin/register-app.js
// Server-side app registration endpoint (Creator only)
// Uses the service role key so RLS doesn't block writes

export async function onRequestPost(context) {
    const { request, env } = context;
    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
        return new Response(JSON.stringify({ 
            error: 'Server configuration missing', 
            details: `SUPABASE_URL: ${!!supabaseUrl}, SERVICE_KEY: ${!!serviceKey}` 
        }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        });
    }

    // 1. Verify caller is the creator
    const cookie = request.headers.get('Cookie') || '';
    const tokenMatch = cookie.match(/adam_session=([^;]+)/);
    const accessToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;

    if (!accessToken) {
        return new Response(JSON.stringify({ error: 'Auth token missing' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': serviceKey }
        });
        
        if (!authRes.ok) {
            const authErr = await authRes.text();
            return new Response(JSON.stringify({ error: 'Session validation failed', details: authErr }), {
                status: 401, headers: { 'Content-Type': 'application/json' }
            });
        }

        const user = await authRes.json();

        // Check creator status from settings table
        const settingsRes = await fetch(
            `${supabaseUrl}/rest/v1/settings?key=eq.creator_email&select=value`,
            { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
        );
        const settings = await settingsRes.json();
        const creatorEmail = settings[0]?.value;

        if (user.email !== creatorEmail) {
            return new Response(JSON.stringify({ error: 'Unauthorized: Not the Creator' }), {
                status: 403, headers: { 'Content-Type': 'application/json' }
            });
        }

    // 2. Parse the app data from request body
    let appData;
    try {
        appData = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
        });
    }

    // 3. Upsert the app using the service role key (bypasses RLS)
    const upsertRes = await fetch(`${supabaseUrl}/rest/v1/apps`, {
        method: 'POST',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation,resolution=merge-duplicates'
        },
        body: JSON.stringify(appData)
    });

    if (!upsertRes.ok) {
        const errText = await upsertRes.text();
        return new Response(JSON.stringify({ error: 'Database error', details: errText }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        });
    }

    const result = await upsertRes.json();
    return new Response(JSON.stringify({ success: true, app: result }), {
        headers: { 'Content-Type': 'application/json' }
    });
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
    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    // Auth check (same as POST)
    const cookie = request.headers.get('Cookie') || '';
    const tokenMatch = cookie.match(/adam_session=([^;]+)/);
    const accessToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
    if (!accessToken) {
        return new Response(JSON.stringify({ error: 'Not authenticated' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
        });
    }

    const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': serviceKey }
    });
    if (!authRes.ok) {
        return new Response(JSON.stringify({ error: 'Invalid session' }), {
            status: 401, headers: { 'Content-Type': 'application/json' }
        });
    }

    const user = await authRes.json();
    const settingsRes = await fetch(
        `${supabaseUrl}/rest/v1/settings?key=eq.creator_email&select=value`,
        { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
    );
    const settings = await settingsRes.json();
    if (user.email !== settings[0]?.value) {
        return new Response(JSON.stringify({ error: 'Creator access required' }), {
            status: 403, headers: { 'Content-Type': 'application/json' }
        });
    }

    // Get app ID from query string
    const url = new URL(request.url);
    const appId = url.searchParams.get('id');
    if (!appId) {
        return new Response(JSON.stringify({ error: 'Missing app id' }), {
            status: 400, headers: { 'Content-Type': 'application/json' }
        });
    }

    const headers = {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    };

    let body = undefined;
    if (method === 'PATCH') {
        body = JSON.stringify(await request.json());
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/apps?id=eq.${appId}`, {
        method, headers, body
    });

    if (!res.ok) {
        const errText = await res.text();
        return new Response(JSON.stringify({ error: 'Database error', details: errText }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
