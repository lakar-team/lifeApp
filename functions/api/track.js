export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    
    const { appId, action, userId } = body;
    
    const logEntry = {
        appId,
        action,
        userId: userId || 'anonymous',
        timestamp: new Date().toISOString(),
        ip: request.headers.get('cf-connecting-ip')
    };

    console.log(`[Granular Track] ${JSON.stringify(logEntry)}`);

    // Future: Write to Cloudflare D1
    // const db = env.DB;
    // await db.prepare("INSERT INTO usage_logs (app_id, action, user_id) VALUES (?, ?, ?)")
    //   .bind(appId, action, userId).run();

    return new Response(JSON.stringify({ success: true, message: 'Pulse recorded' }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
