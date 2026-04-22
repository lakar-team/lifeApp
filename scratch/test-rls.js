// Testing native FETCH (Node 18+)
const SUPABASE_URL = 'https://ailtxstczephzpzssdie.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpbHR4c3RjemVwaHpwenNzZGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NjU3NzYsImV4cCI6MjA5MjM0MTc3Nn0.C5ZMo8voAOTQy-gySxJXXvO0r-hBGvNg_1ImSrob1kc';

async function testRls() {
    console.log("Testing App Visibility as Anon User (Native Fetch)...");
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/apps?select=name,status`, {
            headers: {
                'apikey': ANON_KEY,
                'Authorization': `Bearer ${ANON_KEY}`
            }
        });

        if (res.ok) {
            const apps = await res.json();
            console.log(`Found ${apps.length} apps:`);
            apps.forEach(a => console.log(` - ${a.name} [${a.status}]`));
        } else {
            console.error("Fetch failed:", res.status, res.statusText);
            console.error(await res.text());
        }
    } catch (err) {
        console.error("Script error:", err.message);
    }
}

testRls();
