// functions/_middleware.js
// Global Cloudflare Pages middleware:
// - Protects /apps/* routes with Supabase JWT validation
// - Logs usage to Supabase on every authenticated app access
// - Redirects unauthenticated users to /login

export async function onRequest(context) {
    const { request, next, env } = context;
    const url = new URL(request.url);

    // Only gate /apps/* paths
    if (!url.pathname.startsWith('/apps/')) {
        return next();
    }

    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    // Extract session token from cookie
    const cookie = request.headers.get('Cookie') || '';
    const tokenMatch = cookie.match(/adam_session=([^;]+)/);
    const accessToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;

    if (!accessToken) {
        // No session — redirect to login, remember where they were going
        const loginUrl = new URL('/login', url.origin);
        loginUrl.searchParams.set('redirect', url.pathname);
        return Response.redirect(loginUrl.toString(), 302);
    }

    // Validate token with Supabase
    let user = null;
    try {
        if (!supabaseUrl || !serviceKey) {
            // Env vars not set yet — allow in development
            console.warn('[Middleware] Supabase env vars not configured. Allowing request.');
            return next();
        }

        const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'apikey': serviceKey
            }
        });

        if (!authRes.ok) {
            // Token invalid or expired — redirect to login
            const loginUrl = new URL('/login', url.origin);
            loginUrl.searchParams.set('redirect', url.pathname);
            // Clear the bad cookie
            const response = Response.redirect(loginUrl.toString(), 302);
            response.headers.set('Set-Cookie', 'adam_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax');
            return response;
        }

        user = await authRes.json();
    } catch (err) {
        console.error('[Middleware] Auth check error:', err.message);
        // On error, fail open only in dev; in production, redirect to login
        if (!supabaseUrl) return next();
        return Response.redirect(new URL('/login', url.origin).toString(), 302);
    }

    // Log usage asynchronously (don't block the response)
    if (user?.id) {
        const appSlug = url.pathname.split('/')[2] || 'unknown';
        context.waitUntil(logUsage(supabaseUrl, serviceKey, user.id, appSlug, request));
    }

    // Authenticated — serve the file
    return next();
}

async function logUsage(supabaseUrl, serviceKey, userId, appSlug, request) {
    try {
        // Look up app_id from slug
        const appsRes = await fetch(
            `${supabaseUrl}/rest/v1/apps?slug=eq.${appSlug}&select=id`,
            { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
        );
        const apps = await appsRes.json();
        if (!apps || apps.length === 0) return;

        const appId = apps[0].id;

        await fetch(`${supabaseUrl}/rest/v1/usage_logs`, {
            method: 'POST',
            headers: {
                'apikey': serviceKey,
                'Authorization': `Bearer ${serviceKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                user_id: userId,
                app_id: appId,
                action: 'launch',
                ip: request.headers.get('cf-connecting-ip')
            })
        });
    } catch (err) {
        console.error('[Usage Log] Error:', err.message);
    }
}
