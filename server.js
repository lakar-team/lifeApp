import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import morgan from 'morgan';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Logging
app.use(morgan('dev'));

// --- Middleware for Privacy ---
// Later, this will check for a valid session/token
const authGuard = (req, res, next) => {
  // Placeholder for authentication logic
  // For now, it's open, but we can easily lock it down.
  const isAuthenticated = true; 
  
  if (isAuthenticated) {
    next();
  } else {
    res.status(401).send('Unauthorized: Please login to access this app.');
  }
};

// --- Middleware for Usage Tracking ---
const trackUsage = (req, res, next) => {
  const appName = req.params[0]?.split('/')[0] || 'unknown';
  const logEntry = {
    appName,
    path: req.path,
    timestamp: new Date().toISOString(),
    ip: req.ip
  };

  console.log(`[Usage] App: ${appName} | Path: ${req.path}`);

  // Append to logs.json
  const logFile = path.join(__dirname, 'usage_logs.json');
  let logs = [];
  try {
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }
    logs.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error('Error writing usage logs:', err);
  }

  next();
};

// Serve the public portal
app.use(express.static(path.join(__dirname, 'public')));

// Serve private apps with guards
app.use('/apps', authGuard, trackUsage, express.static(path.join(__dirname, 'apps')));

// API for app list (Future)
app.get('/api/apps', (req, res) => {
  // Return list of apps from config
  res.json([
    { id: 'math-genie', name: 'Math Genie', description: 'Advanced calculator', path: '/apps/math-genie' }
  ]);
});

app.listen(PORT, () => {
  console.log(`
  🚀 Portal is running at http://localhost:${PORT}
  🔒 Private apps directory: /apps
  📊 Tracking enabled
  `);
});
