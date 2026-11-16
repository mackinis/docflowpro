-- DocFlow Pro - Cloudflare D1 Normalized Schema
-- Migration 0001: Initial schema

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR')),
  avatar TEXT,
  phone TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  province TEXT DEFAULT '',
  country TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  is_verified INTEGER NOT NULL DEFAULT 0,
  verification_token_hash TEXT,
  token_created_at TEXT,
  has_sensitive_edit_override INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  real_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS process_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT 'Inmobiliaria',
  original_document_content TEXT DEFAULT '',
  show_document_to_all INTEGER NOT NULL DEFAULT 1,
  shared_view_mode TEXT NOT NULL DEFAULT 'both' CHECK (shared_view_mode IN ('both', 'flow', 'document')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_stages (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES process_templates(id) ON DELETE CASCADE,
  stage_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_stages_template ON template_stages(template_id, stage_order);

CREATE TABLE IF NOT EXISTS stage_requirements (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES template_stages(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES process_templates(id) ON DELETE CASCADE,
  req_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('document', 'form', 'task')),
  description TEXT NOT NULL DEFAULT '',
  is_required INTEGER NOT NULL DEFAULT 1,
  form_fields_json TEXT,
  document_source_type TEXT,
  linked_template_id TEXT,
  linked_shared_document_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_reqs_stage ON stage_requirements(stage_id, req_order);
CREATE INDEX IF NOT EXISTS idx_reqs_template ON stage_requirements(template_id);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'pending_review', 'observed', 'completed', 'pending_assignment')),
  template_id TEXT NOT NULL DEFAULT '',
  current_stage_index INTEGER NOT NULL DEFAULT 0,
  assigned_advisor_id TEXT NOT NULL DEFAULT '',
  assigned_manager_id TEXT NOT NULL DEFAULT '',
  document_content TEXT DEFAULT '',
  show_document_to_all INTEGER NOT NULL DEFAULT 1,
  shared_view_mode TEXT NOT NULL DEFAULT 'both' CHECK (shared_view_mode IN ('both', 'flow', 'document')),
  is_current_stage_approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_advisor ON cases(assigned_advisor_id);
CREATE INDEX IF NOT EXISTS idx_cases_manager ON cases(assigned_manager_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);

CREATE TABLE IF NOT EXISTS case_participants (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dni TEXT DEFAULT '',
  cuit_cuil TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  birth_date TEXT,
  role TEXT DEFAULT 'Vendedor',
  comments TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_participants_case ON case_participants(case_id);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'uploaded', 'in_review', 'approved', 'rejected', 'expired')),
  file_name TEXT,
  mime_type TEXT,
  file_size INTEGER DEFAULT 0,
  r2_key TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT,
  allowed_roles_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_documents_req ON documents(case_id, requirement_id);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(document_id, uploaded_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
  completed_by TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_case ON tasks(case_id);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  requirement_id TEXT,
  document_id TEXT,
  text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  resolved_by TEXT,
  resolved_at TEXT,
  response TEXT
);

CREATE INDEX IF NOT EXISTS idx_observations_case ON observations(case_id);

CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  stage_id TEXT,
  requirement_id TEXT NOT NULL UNIQUE,
  values_json TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_form_subs_req ON form_submissions(requirement_id);

CREATE TABLE IF NOT EXISTS upload_requests (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  requirement_name TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_extension TEXT NOT NULL,
  allowed_extension TEXT,
  allowed_max_weight INTEGER,
  response_comment TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_upload_requests_case ON upload_requests(case_id);

CREATE TABLE IF NOT EXISTS shared_documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  allowed_roles_json TEXT,
  allowed_user_ids_json TEXT
);

CREATE TABLE IF NOT EXISTS system_messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  receiver_role TEXT NOT NULL,
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  deleted_by_sender INTEGER NOT NULL DEFAULT 0,
  deleted_by_receiver INTEGER NOT NULL DEFAULT 0,
  permanent_deleted_by_sender INTEGER NOT NULL DEFAULT 0,
  permanent_deleted_by_receiver INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON system_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON system_messages(receiver_id);

CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES system_messages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_attachments ON message_attachments(message_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('info', 'success', 'warning', 'error')),
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  case_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
