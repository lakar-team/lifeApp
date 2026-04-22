/**
 * ADAMTOOL — Sync Apps Script
 * Scans public/apps/ for app.json manifests and upserts them into Supabase.
 * Run by GitHub Actions on every push to main.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars. SUPABASE_URL:', !!SUPABASE_URL, 'SERVICE_KEY:', !!SERVICE_KEY);
  process.exit(1);
}

async function sync() {
  const appsDir = path.join(__dirname, '../public/apps');

  if (!fs.existsSync(appsDir)) {
    console.log('No public/apps/ directory found. Nothing to sync.');
    return;
  }

  const items = fs.readdirSync(appsDir);
  const apps = [];

  for (const dirName of items) {
    const dirPath = path.join(appsDir, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const manifestPath = path.join(dirPath, 'app.json');
    if (!fs.existsSync(manifestPath)) {
      console.log(`  [skip] ${dirName}/ — no app.json`);
      continue;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const app = {
        slug: manifest.slug || dirName,
        name: manifest.name || dirName,
        description: manifest.description || '',
        path: manifest.path || `/apps/${dirName}/`,
        icon: manifest.icon || 'wrench',
        status: manifest.status || 'live',
        sort_order: manifest.sort_order ?? 0
      };
      apps.push(app);
      console.log(`  [found] ${app.slug} → "${app.name}" (${app.status})`);
    } catch (e) {
      console.error(`  [error] ${dirName}/app.json: ${e.message}`);
    }
  }

  if (apps.length === 0) {
    console.log('No apps with app.json found.');
    return;
  }

  console.log(`\nUpserting ${apps.length} app(s) to Supabase...`);

  // Insert each app individually to handle errors gracefully
  for (const app of apps) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/apps`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(app)
      });

      if (res.ok) {
        console.log(`  ✓ ${app.slug} synced`);
      } else {
        const errText = await res.text();
        console.error(`  ✗ ${app.slug} failed (${res.status}): ${errText}`);
      }
    } catch (e) {
      console.error(`  ✗ ${app.slug} network error: ${e.message}`);
    }
  }

  console.log('\nSync complete.');
}

sync().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
