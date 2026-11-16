import type { User } from '../src/types';

export interface QueueJob {
  type: 'notification_fanout' | 'cleanup_unverified' | 'audit_log';
  payload: Record<string, any>;
}

export interface Env {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  KV: KVNamespace;
  AI: Ai;
  DOCFLOW_QUEUE: Queue<QueueJob>;
  ASSETS: Fetcher;
  APP_NAME?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface AuthSession {
  sessionId: string;
  user: User;
  realUser: User;
}

export type AppVariables = {
  auth: AuthSession | null;
};
