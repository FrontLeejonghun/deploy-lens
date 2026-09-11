import express from 'express';
import { fileURLToPath } from 'node:url';
import compare from '../api/compare.mjs';
const app = express();
const port = Number(process.env.PORT ?? 4317);
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.all('/api/compare', compare);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(fileURLToPath(new URL('../dist', import.meta.url))));
  app.get('/{*path}', (_req, res) =>
    res.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url))),
  );
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error, _req, res, _next) =>
  res.status(error.status ?? 500).json({ error: '요청을 처리하지 못했습니다.' }),
);
app.listen(port, '127.0.0.1', () => console.log(`Deploy Lens: http://127.0.0.1:${port}`));
