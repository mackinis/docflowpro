export type Role = 'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'ASESOR';

export interface User {
  id: string;
  name: string;
  lastName: string;
  email: string;
  role: Role;
  avatar?: string;
  phone?: string;
  active: boolean;
  address?: string;
  city?: string;
  province?: string;
  country?: string;
  passwordHash?: string;
  isVerified?: boolean;
  verificationToken?: string;
  verificationTokenSms?: string;
  tokenCreatedAt?: string;
  hasSensitiveEditPermissionOverride?: boolean; // Superadmin manual toggle
}

export type ParticipantType = 'Cliente' | 'Comprador' | 'Vendedor' | 'Titular' | 'Garante' | 'Apoderado' | 'Escribano';

export interface Participant {
  id: string;
  name: string;
  lastName: string;
  dni: string;
  cuitCuil: string;
  email: string;
  phone: string;
  birthDate?: string;
  role?: ParticipantType;
  comments?: string;
}

export type RequirementType = 'document' | 'form' | 'task';

export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean';
  required: boolean;
  options?: string[];
}

export interface Requirement {
  id: string;
  name: string;
  type: RequirementType;
  description: string;
  isRequired: boolean;
  formFields?: FormField[]; // Only populated for type 'form'
  documentSourceType?: 'digital_contract' | 'download_asset' | 'manual_upload';
  linkedTemplateId?: string;
  linkedSharedDocumentId?: string;
}

export interface Stage {
  id: string;
  name: string;
  description: string;
  requirements: Requirement[];
}

export interface ProcessTemplate {
  id: string;
  name: string;
  description: string;
  industry: 'Inmobiliaria' | 'Jurídico' | 'Seguros' | 'Financiera' | 'Recursos Humanos' | 'Administrativo';
  stages: Stage[];
  originalDocumentContent?: string; // 100% recognized continuous document text
  showDocumentToAll?: boolean; // Toggle to decide if other roles can see the digital document
  sharedViewMode?: 'both' | 'flow' | 'document'; // Shared view mode for normal users (chosen by superadmin)
}

export type CaseStatus = 'active' | 'pending_review' | 'observed' | 'completed' | 'pending_assignment';

export interface Case {
  id: string;
  code: string;
  title: string;
  description: string;
  status: CaseStatus;
  templateId: string;
  currentStageIndex: number;
  assignedAdvisorId: string;
  assignedManagerId: string;
  participants: Participant[];
  createdAt: string;
  updatedAt: string;
  documentContent?: string; // Case-specific digital document for completing
  showDocumentToAll?: boolean; // Copied from template, customizable per case
  sharedViewMode?: 'both' | 'flow' | 'document'; // Custom shared view mode configured per case
  isCurrentStageApproved?: boolean; // Track if the current stage has been approved by the manager
}

export type DocStatus = 'pending' | 'uploaded' | 'in_review' | 'approved' | 'rejected' | 'expired';

export interface DocumentVersion {
  fileName: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Document {
  id: string;
  caseId: string;
  stageId: string;
  requirementId: string;
  name: string;
  status: DocStatus;
  fileName?: string;
  fileSize?: number;
  uploadedBy?: string;
  uploadedAt?: string;
  versions: DocumentVersion[];
  allowedRoles?: string[];
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface Task {
  id: string;
  caseId: string;
  stageId: string;
  requirementId: string;
  name: string;
  description: string;
  status: TaskStatus;
  completedBy?: string;
  completedAt?: string;
}

export interface Observation {
  id: string;
  caseId: string;
  stageId: string;
  requirementId?: string;
  documentId?: string;
  text: string;
  createdBy: string;
  createdAt: string;
  status: 'open' | 'resolved';
  resolvedBy?: string;
  resolvedAt?: string;
  response?: string; // advisor's explanation/answer
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: string;
  caseId?: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string;
  createdAt: string;
}

export interface FormDataValue {
  requirementId: string;
  values: Record<string, string | number | boolean>;
  submittedBy: string;
  submittedAt: string;
}

// Full State returned from server or stored locally
export interface AppDataState {
  users: User[];
  templates: ProcessTemplate[];
  cases: Case[];
  documents: Document[];
  tasks: Task[];
  observations: Observation[];
  notifications: Notification[];
  auditLogs: AuditLog[];
  formSubmissions: FormDataValue[];
  activeIndustry?: string;
  verificationPolicies?: {
    global?: 'email' | 'sms' | 'both';
    ASESOR?: 'email' | 'sms' | 'both';
    MANAGER?: 'email' | 'sms' | 'both';
    ADMIN?: 'email' | 'sms' | 'both';
  };
  systemMessages?: SystemMessage[];
  systemSettings?: SystemSettings;
  sharedDocuments?: SharedDocument[];
  uploadRequests?: UploadRequest[];
}

export interface UploadRequest {
  id: string;
  caseId: string;
  stageId: string;
  requirementId: string;
  requirementName: string;
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedExtension: string;
  allowedExtension?: string;
  allowedMaxWeight?: number; // in MB (1 to 25)
  responseComment?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface SharedDocument {
  id: string;
  name: string;
  fileName: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  allowedRoles?: string[]; // e.g. ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR']
  allowedUserIds?: string[]; // specific user IDs
  dataUrl?: string; // base64 URL of content
}

export interface SystemMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  receiverId: string;
  receiverName: string;
  receiverRole: string;
  subject: string;
  content: string;
  createdAt: string;
  read: boolean;
  deletedBySender?: boolean;
  deletedByReceiver?: boolean;
  attachments?: {
    name: string;
    size: number;
    dataUrl?: string; // simulation of file data
  }[];
}

export interface RoleMessagingConfig {
  allowed: boolean;
  rule: 'free' | 'wait_reply';
}

export interface SystemSettings {
  roleMessagingConfigs?: {
    SUPERADMIN: RoleMessagingConfig;
    ADMIN: RoleMessagingConfig;
    MANAGER: RoleMessagingConfig;
    ASESOR: RoleMessagingConfig;
  };
  tabOrder?: string[];
  allowAdminManagerTemplates?: boolean;
  processTemplateRequired?: boolean;
}

