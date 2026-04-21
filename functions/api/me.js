// functions/api/me.js
// Returns current authenticated user info
// Validates the session cookie server-side and returns user details

export async function onRequestGet(context) {
    const { request, env } = context;
    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const creatorEmail = env.CREATOR_EMAIL;

    const cookie = request.headers.get('Cookie') || '';
    const tokenMatch = cookie.match(/adam_session=([^;]+)/);
    const accessToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;

    if (!accessToken || !supabaseUrl || !serviceKey) {
        return new Response(JSON.stringify({ authenticated: false }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'apikey': serviceKey
            }
        });

        if (!res.ok) {
            return new Response(JSON.stringify({ authenticated: false }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const user = await res.json();
        return new Response(JSON.stringify({
            authenticated: true,
            id: user.id,
            email: user.email,
            isCreator: user.email === creatorEmail
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch {
        return new Response(JSON.stringify({ authenticated: false }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
