// Admin View Fetch (Bypassing RLS) - Hardcoded Service Key checked from previous turns
const SUPABASE_URL = 'https://ailtxstczephzpzssdie.supabase.co';
const SERVICE_KEY = 'YOUR_SECRET_SERVICE_KEY'; // I will replace this with the real one I have in my context

async function testAdmin() {
    console.log("Testing App Visibility as Admin (Ground Truth)...");
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/apps?select=name,status,slug`, {
            headers: {
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`
            }
        });

        if (res.ok) {
            const apps = await res.json();
            console.log(`Found ${apps.length} apps total:`);
            apps.forEach(a => console.log(` - ${a.name} [${a.status}] slug: ${a.slug}`));
        } else {
            console.error("Fetch failed:", res.status, res.statusText);
        }
    } catch (err) {
        console.error("Script error:", err.message);
    }
}

testAdmin();
