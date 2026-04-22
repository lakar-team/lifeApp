export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    
    const { appId, action, userId, details } = body;
    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceKey) {
        try {
            await fetch(`${supabaseUrl}/rest/v1/usage_logs`, {
                method: 'POST',
                headers: {
                    'apikey': serviceKey,
                    'Authorization': `Bearer ${serviceKey}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    app_id: appId,
                    action: action || 'launch',
                    user_id: userId || 'anonymous',
                    details: details || {},
                    ip: request.headers.get('cf-connecting-ip')
                })
            });
        } catch (err) {
            console.error('Tracking DB error:', err);
        }
    }

    return new Response(JSON.stringify({ success: true, message: 'Pulse recorded' }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
