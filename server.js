import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// API routes - import the bundled backend
// NOTE: The backend bundle is in api/index.mjs
// You need to configure DATABASE_URL and SESSION_SECRET env vars
let apiApp;
try {
  const { default: apiRouter } = await import('./api/index.mjs');
  // apiRouter might be an Express app or a router
  if (apiRouter && typeof apiRouter.use === 'function') {
    app.use('/api', apiRouter);
  } else {
    console.warn('API module loaded but not a valid Express app/router');
  }
} catch (e) {
  console.warn('API module not loaded:', e.message);
  // Fallback: provide API health endpoint
  app.get('/api/healthz', (req, res) => {
    res.json({ status: 'ok', mode: 'static-only', note: 'Backend API not available. Check DATABASE_URL env var.' });
  });
}

// SPA fallback: serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`WorkForce Pro running on port ${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
});
