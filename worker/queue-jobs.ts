import type { Env, QueueJob } from './types';
import { createAudit, createNotification } from './db';

export async function dispatchQueueJob(env: Env, job: QueueJob): Promise<void> {
  if (env.DOCFLOW_QUEUE) {
    try {
      await env.DOCFLOW_QUEUE.send(job);
      return;
    } catch (err) {
      console.warn('Queue send fallback to inline execution:', err);
    }
  }
  await processQueueJob(job, env);
}

export async function processQueueJob(job: QueueJob, env: Env): Promise<void> {
  if (job.type === 'notification_fanout') {
    const { userIds, title, message, notifType, caseId } = job.payload;
    if (Array.isArray(userIds)) {
      for (const uid of userIds) {
        await createNotification(env.DB, uid, title, message, notifType || 'info', caseId);
      }
    }
  } else if (job.type === 'cleanup_unverified') {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      "DELETE FROM users WHERE is_verified = 0 AND role != 'SUPERADMIN' AND token_created_at IS NOT NULL AND token_created_at < ?"
    )
      .bind(cutoff)
      .run();
  } else if (job.type === 'audit_log') {
    const { userId, action, entityType, entityId, entityName } = job.payload;
    await createAudit(env.DB, userId, action, entityType, entityId, entityName);
  }
}

