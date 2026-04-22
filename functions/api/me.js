// functions/api/me.js
// Returns current authenticated user info
// Validates the session cookie server-side and returns user details

export async function onRequestGet(context) {
    const { request, env } = context;
    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    const cookie = request.headers.get('Cookie') || '';
    const tokenMatch = cookie.match(/adam_session=([^;]+)/);
    const accessToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;

    if (!accessToken || !supabaseUrl || !serviceKey) {
        return new Response(JSON.stringify({ authenticated: false }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // 1. Get User from Supabase Auth
        const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'apikey': serviceKey
            }
        });

        if (!authRes.ok) {
            return new Response(JSON.stringify({ authenticated: false }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const user = await authRes.json();

        // 2. Fetch Creator Email from Settings table
        const settingsRes = await fetch(
            `${supabaseUrl}/rest/v1/settings?key=eq.creator_email&select=value`,
            { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
        );
        const settings = await settingsRes.json();
        const creatorEmail = settings[0]?.value;

        return new Response(JSON.stringify({
            authenticated: true,
            id: user.id,
            email: user.email,
            isCreator: user.email === creatorEmail
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error('API /me error:', err.message);
        return new Response(JSON.stringify({ authenticated: false }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
