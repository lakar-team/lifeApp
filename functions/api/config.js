// functions/api/config.js
// Returns public Supabase config to the browser frontend
// These keys are SAFE to expose (anon key = public by design)

export async function onRequestGet(context) {
    const { env } = context;

    return new Response(JSON.stringify({
        supabaseUrl: env.SUPABASE_URL || '',
        supabaseAnonKey: env.SUPABASE_ANON_KEY || ''
    }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600'
        }
    });
}
