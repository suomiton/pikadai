import { Hono } from 'hono';
import type { AppEnv } from './env';
import { deleteExpiredEvents } from './db/queries';
import { HttpError } from './lib/http';
import { events } from './routes/events';
import { options } from './routes/options';
import { participants } from './routes/participants';
import { tickets } from './routes/tickets';

const app = new Hono<AppEnv>();

app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
});

app.route('/api/tickets', tickets);
app.route('/api/events', events);
app.route('/api/events/:id/options', options);
app.route('/api/events/:id/participants', participants);

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Not found', code: 'not_found' }, 404);
  }
  // Anything else is the SPA; let the static asset handler serve it.
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, code: err.code, details: err.details }, err.status);
  }
  console.error('Unhandled error', err);
  return c.json({ error: 'Something went wrong', code: 'internal' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      deleteExpiredEvents(env.DB, Date.now()).then((n) => {
        console.log(`Purged ${n} expired poll(s)`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
