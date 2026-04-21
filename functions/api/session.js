// functions/api/session.js
// Called by the frontend after a successful Supabase auth
// Sets a secure, HttpOnly cookie storing the access token
// This cookie is what our middleware reads to authenticate requests

export async function onRequestPost(context) {
    const { request } = context;

    let token;
    try {
        const body = await request.json();
        token = body.token;
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid request body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (!token) {
        return new Response(JSON.stringify({ error: 'Token is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Set secure, httpOnly cookie (1 hour = 3600s)
    const cookie = [
        `adam_session=${encodeURIComponent(token)}`,
        'Path=/',
        'Max-Age=3600',
        'HttpOnly',
        'Secure',
        'SameSite=Lax'
    ].join('; ');

    return new Response(JSON.stringify({ success: true }), {
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': cookie
        }
    });
}

// DELETE: logout
export async function onRequestDelete(context) {
    const clearedCookie = [
        'adam_session=',
        'Path=/',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'HttpOnly',
        'Secure',
        'SameSite=Lax'
    ].join('; ');

    return new Response(JSON.stringify({ success: true }), {
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': clearedCookie
        }
    });
}
