// functions/_middleware.js
// Global Cloudflare Pages middleware:
// - Protects /apps/* routes with Supabase JWT validation
// - Logs a 'launch' to Supabase when an authenticated user opens a tool page
// - Redirects unauthenticated users to /login

import { CLEAR_SESSION_COOKIE, getSessionToken, getUser, serviceHeaders } from './_lib/auth.js';

export async function onRequest(context) {
    const { request, next, env } = context;
    const url = new URL(request.url);

    // Only gate /apps/* paths
    if (!url.pathname.startsWith('/apps/')) {
        return next();
    }

    const loginUrl = new URL('/login', url.origin);
    loginUrl.searchParams.set('redirect', url.pathname);

    const accessToken = getSessionToken(request);
    if (!accessToken) {
        // No session — redirect to login, remember where they were going
        return Response.redirect(loginUrl.toString(), 302);
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        // Env vars not set yet — allow in development
        console.warn('[Middleware] Supabase env vars not configured. Allowing request.');
        return next();
    }

    let user;
    try {
        user = await getUser(env, accessToken);
    } catch (err) {
        console.error('[Middleware] Auth check error:', err.message);
        return Response.redirect(loginUrl.toString(), 302);
    }

    if (!user) {
        // Token invalid or expired — clear the bad cookie and go to login.
        // (Response.redirect() headers are immutable, so build the 302 by hand.)
        return new Response(null, {
            status: 302,
            headers: { 'Location': loginUrl.toString(), 'Set-Cookie': CLEAR_SESSION_COOKIE }
        });
    }

    // Log one launch per page open, not per asset (css/js/images) it loads.
    const isPageLoad = request.method === 'GET' &&
        (url.pathname.endsWith('/') || url.pathname.endsWith('.html'));
    if (isPageLoad && user.id) {
        const appSlug = url.pathname.split('/')[2] || 'unknown';
        context.waitUntil(logUsage(env, user.id, appSlug, request));
    }

    // Authenticated — serve the file
    return next();
}

async function logUsage(env, userId, appSlug, request) {
    try {
        // Look up app_id from slug
        const appsRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/apps?slug=eq.${encodeURIComponent(appSlug)}&select=id`,
            { headers: serviceHeaders(env) }
        );
        const apps = await appsRes.json();
        if (!Array.isArray(apps) || apps.length === 0) return;

        await fetch(`${env.SUPABASE_URL}/rest/v1/usage_logs`, {
            method: 'POST',
            headers: serviceHeaders(env, { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
            body: JSON.stringify({
                user_id: userId,
                app_id: apps[0].id,
                action: 'launch',
                ip: request.headers.get('cf-connecting-ip')
            })
        });
    } catch (err) {
        console.error('[Usage Log] Error:', err.message);
    }
}
