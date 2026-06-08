import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

const PORT = process.env.PORT || 3000;

// CORS FIX
app.use(cors({
  origin: [
    'https://work.dreamtechnologies.in'
  ],
  credentials: true
}));

app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// Load API
try {
  const { default: apiRouter } = await import('./api/index.mjs');

  if (apiRouter && typeof apiRouter.use === 'function') {
    app.use('/api', apiRouter);
  }

} catch (e) {

  console.warn('API module not loaded:', e.message);

  app.get('/api/healthz', (req, res) => {
    res.json({
      status: 'ok',
      mode: 'static-only'
    });
  });

}

// SPA fallback
app.get(/.*/, (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(
      path.join(__dirname, 'public', 'index.html')
    );
  }
});

app.listen(PORT, () => {
  console.log(`Server started on ${PORT}`);
});
