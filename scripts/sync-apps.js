/**
 * ADAMTOOL — Sync Apps Script (Updated)
 * This script scans public/apps/ for metadata and updates the Supabase database.
 * Run by GitHub Actions.
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

async function sync() {
  const appsDir = path.join(__dirname, '../public/apps');
  const items = fs.readdirSync(appsDir);
  const apps = [];

  for (const slug of items) {
    const dirPath = path.join(appsDir, slug);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const manifestPath = path.join(dirPath, 'app.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        apps.push({
          slug: manifest.slug || slug,
          name: manifest.name,
          description: manifest.description,
          path: manifest.path || `/apps/${slug}/`,
          icon: manifest.icon || 'wrench',
          status: manifest.status || 'live',
          sort_order: manifest.sort_order || 0
        });
        console.log(`- Detected app: ${slug}`);
      } catch (e) {
        console.error(`- Error parsing ${manifestPath}:`, e.message);
      }
    }
  }

  if (apps.length === 0) {
    console.log('No apps found to sync.');
    return;
  }

  console.log(`Syncing ${apps.length} apps to Supabase...`);

  // Use UPSERT via POST with ?on_conflict=slug
  const url = `${SUPABASE_URL}/rest/v1/apps?on_conflict=slug`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify(apps)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Sync failed (Status ${response.status}):`, errText);
    process.exit(1);
  }

  console.log('Successfully synced apps catalog.');
}

sync().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
