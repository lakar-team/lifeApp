// functions/api/admin/analytics.js
// Aggregated analytics for the Creator Dashboard

import { getSessionToken, getUser, isCreator, serviceHeaders, json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const supabaseUrl = env.SUPABASE_URL;

    if (!supabaseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) {
        return json({ error: 'Server configuration missing' }, 500);
    }

    try {
        // 1. Auth check
        const user = await getUser(env, getSessionToken(request));
        if (!user) return json({ error: 'Unauthorized' }, 401);
        if (!(await isCreator(env, user))) return json({ error: 'Forbidden' }, 403);

        const headers = serviceHeaders(env);
        const countHeaders = serviceHeaders(env, { 'Prefer': 'count=exact' });

        // 2. Fetch Aggregated Stats
        // Total Users
        const usersCountRes = await fetch(`${supabaseUrl}/rest/v1/user_profiles?select=id`, {
            method: 'HEAD', headers: countHeaders
        });
        const totalUsers = usersCountRes.headers.get('content-range')?.split('/')[1] || 0;

        // Total Launches
        const launchesCountRes = await fetch(`${supabaseUrl}/rest/v1/usage_logs?action=eq.launch&select=id`, {
            method: 'HEAD', headers: countHeaders
        });
        const totalLaunches = launchesCountRes.headers.get('content-range')?.split('/')[1] || 0;

        // App-specific Breakdown — counted in the database, not by pulling every log row
        const breakdownRes = await fetch(
            `${supabaseUrl}/rest/v1/apps?select=id,name,slug,usage_logs(count)&usage_logs.action=eq.launch`,
            { headers }
        );
        const appsData = breakdownRes.ok ? await breakdownRes.json() : [];
        const appStats = appsData.map(a => ({
            id: a.id,
            name: a.name,
            slug: a.slug,
            launches: a.usage_logs?.[0]?.count || 0
        })).sort((a, b) => b.launches - a.launches);

        // Recent Activity
        const recentRes = await fetch(
            `${supabaseUrl}/rest/v1/usage_logs?select=*,apps(name),user_profiles(email)&order=created_at.desc&limit=10`,
            { headers }
        );
        const recentLogs = recentRes.ok ? await recentRes.json() : [];

        return json({
            stats: {
                totalUsers: parseInt(totalUsers),
                totalLaunches: parseInt(totalLaunches)
            },
            appStats,
            recentLogs
        });

    } catch (err) {
        console.error('Analytics API error:', err);
        return json({ error: 'Server error', details: err.message }, 500);
    }
}
