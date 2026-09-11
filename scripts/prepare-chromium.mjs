import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
if (process.env.VERCEL) {
  const destination = fileURLToPath(new URL('../server/chromium', import.meta.url));
  await mkdir(destination, { recursive: true });
  await cp(
    fileURLToPath(new URL('../node_modules/@sparticuz/chromium/bin', import.meta.url)),
    destination,
    { recursive: true, dereference: true },
  );
}
