import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppModule, loadConfig } from './app.module';

/** Shared by main() and the integration tests. */
export function setupApp(app: INestApplication) {
  const config = loadConfig();
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Telegram's Mini App bridge script.
          scriptSrc: ["'self'", 'https://telegram.org'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          imgSrc: ["'self'", 'data:', 'https://t.me', 'https://telegram.org'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", 'wss:', 'ws:'],
          // Telegram Web shows Mini Apps in a frame; phones and Telegram Desktop do not need this.
          frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
          // Off so the game also works over plain http://localhost while testing; the tunnel adds https.
          upgradeInsecureRequests: null,
        },
      },
      // X-Frame-Options cannot allow Telegram Web; frame-ancestors above does the job instead.
      frameguard: false,
    }),
  );
  app.enableCors({ origin: config.corsOrigins.length ? config.corsOrigins : true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return config;
}

/**
 * Serves the built web apps from the same address as the API, so one service and one https address run
 * everything: the game (miniapp/dist) at "/" and the staff dashboard (admin/dist) at "/admin/".
 * A missing build is skipped (for example while developing with Vite).
 */
function serveWebApps(app: NestExpressApplication) {
  const root = join(__dirname, '..', '..');
  const apps = [
    { name: 'Dashboard', prefix: '/admin', dir: resolve(process.env.ADMIN_DIST ?? join(root, 'admin', 'dist')) },
    { name: 'MiniApp', prefix: '', dir: resolve(process.env.MINIAPP_DIST ?? join(root, 'miniapp', 'dist')) },
  ];
  for (const web of apps) {
    const index = join(web.dir, 'index.html');
    if (!existsSync(index)) {
      new Logger(web.name).warn(`No build at ${web.dir}; not served.`);
      continue;
    }
    app.useStaticAssets(web.dir, {
      prefix: web.prefix ? `${web.prefix}/` : undefined,
      index: false,
      setHeaders: (res, path) => {
        // Built files have a content hash in their name and never change; sounds change rarely.
        if (path.includes(join('assets', ''))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (path.includes('sounds')) res.setHeader('Cache-Control', 'public, max-age=86400');
      },
    });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      if (web.prefix ? !req.path.startsWith(web.prefix) : req.path.startsWith('/admin')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
    new Logger(web.name).log(`Serving ${web.dir} at ${web.prefix || '/'}`);
  }
}

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = setupApp(app);
  serveWebApps(app);
  await app.listen(config.port, '0.0.0.0');
}

if (require.main === module) void main();
