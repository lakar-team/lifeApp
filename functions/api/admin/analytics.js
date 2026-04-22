// functions/api/admin/analytics.js
// Aggregated analytics for the Creator Dashboard

export async function onRequestGet(context) {
    const { request, env } = context;
    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    // 1. Auth check (Same as register-app)
    const cookie = request.headers.get('Cookie') || '';
    const tokenMatch = cookie.match(/adam_session=([^;]+)/);
    const accessToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;

    if (!accessToken || !supabaseUrl || !serviceKey) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    try {
        const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': serviceKey }
        });
        if (!authRes.ok) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });
        const user = await authRes.json();

        const settingsRes = await fetch(`${supabaseUrl}/rest/v1/settings?key=eq.creator_email&select=value`, {
            headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
        });
        const settings = await settingsRes.json();
        if (user.email !== settings[0]?.value) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

        // 2. Fetch Aggregated Stats
        // Total Users
        const usersCountRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles?select=id`, {
            method: 'HEAD',
            headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Prefer': 'count=exact' }
        });
        const totalUsers = usersCountRes.headers.get('content-range')?.split('/')[1] || 0;

        // Total Launches
        const launchesCountRes = await fetch(`${supabaseUrl}/rest/v1/usage_logs?action=eq.launch&select=id`, {
            method: 'HEAD',
            headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Prefer': 'count=exact' }
        });
        const totalLaunches = launchesCountRes.headers.get('content-range')?.split('/')[1] || 0;

        // App-specific Breakdown
        const breakdownRes = await fetch(
            `${supabaseUrl}/rest/v1/apps?select=id,name,slug,usage_logs(id)&usage_logs.action=eq.launch`,
            { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
        );
        const appsData = await breakdownRes.json();
        const appStats = appsData.map(a => ({
            id: a.id,
            name: a.name,
            slug: a.slug,
            launches: a.usage_logs?.length || 0
        })).sort((a, b) => b.launches - a.launches);

        // Recent Activity
        const recentRes = await fetch(
            `${supabaseUrl}/rest/v1/usage_logs?select=*,apps(name),user_profiles(email)&order=created_at.desc&limit=10`,
            { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
        );
        const recentLogs = await recentRes.json();

        return new Response(JSON.stringify({
            stats: {
                totalUsers: parseInt(totalUsers),
                totalLaunches: parseInt(totalLaunches)
            },
            appStats,
            recentLogs
        }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
        console.error('Analytics API error:', err);
        return new Response(JSON.stringify({ error: 'Server error', details: err.message }), { status: 500 });
    }
}
