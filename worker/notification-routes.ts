import type { Hono, Context } from 'hono';
import type { Env, AppVariables } from './types';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;
type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/** Notification read/delete endpoints; authentication middleware remains global. */
export function registerNotificationRoutes(app: WorkerApp) {
app.get('/api/notifications', async (c) => {
  const auth = c.get('auth')!;
  const res = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC'
  )
    .bind(auth.user.id)
    .all<any>();
  return c.json(
    (res.results || []).map((n) => ({
      id: n.id,
      userId: n.user_id,
      title: n.title,
      message: n.message,
      type: n.type,
      read: n.read === 1,
      createdAt: n.created_at,
      caseId: n.case_id || undefined,
    }))
  );
});

async function handleReadNotif(c: AppContext) {
  const { id } = c.req.param();
  const auth = c.get('auth')!;
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').bind(id, auth.user.id).run();
  const notif = await c.env.DB.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').bind(id, auth.user.id).first<any>();
  return c.json(
    notif
      ? {
          id: notif.id,
          userId: notif.user_id,
          title: notif.title,
          message: notif.message,
          type: notif.type,
          read: notif.read === 1,
          createdAt: notif.created_at,
          caseId: notif.case_id || undefined,
        }
      : null
  );
}

app.post('/api/notifications/:id/read', handleReadNotif);
app.put('/api/notifications/:id/read', handleReadNotif);

app.delete('/api/notifications/:id', async (c) => {
  const { id } = c.req.param();
  const auth = c.get('auth')!;
  await c.env.DB.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').bind(id, auth.user.id).run();
  return c.json({ success: true });
});

async function handleReadAllNotifs(c: AppContext) {
  const auth = c.get('auth')!;
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?')
    .bind(auth.user.id)
    .run();
  return c.json({ success: true });
}

app.post('/api/notifications/read-all', handleReadAllNotifs);
app.put('/api/notifications/read-all', handleReadAllNotifs);

app.post('/api/notifications/clear-all', async (c) => {
  const auth = c.get('auth')!;
  await c.env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(auth.user.id).run();
  return c.json({ success: true });
});


}
