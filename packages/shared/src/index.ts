export type LeadStatus = "new" | "contacted" | "interested" | "followup" | "won" | "lost";
export type AgentRole = "admin" | "manager" | "agent";
export type MessageDirection = "in" | "out";
export type MessageType = "text" | "image" | "video" | "document" | "audio" | "template" | "media";
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "retrying" | "waiting_connection" | "skipped";
export type TaskStatus = "pending" | "done" | "missed";

export interface ConsentState {
  optedIn: boolean;
  optedOutAt?: string;
  source?: string;
}

export interface LeadDTO {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  /** Pre-computed display name: savedName → pushName → phone */
  displayName: string;
  /** WhatsApp push name (name shown on their phone) */
  pushName?: string;
  /** WhatsApp profile picture URL */
  profilePic?: string;
  status: LeadStatus;
  tags: string[];
  assignedTo?: string;
  source: string;
  consent: ConsentState;
  unreadCount: number;
  lastInboundAt?: string;
  windowExpiresAt?: string;
  createdAt: string;
  lastActivity: string;
}

export interface MessageDTO {
  id: string;
  leadId: string;
  direction: MessageDirection;
  type: MessageType;
  text?: string;
  templateId?: string;
  status: MessageStatus;
  waMessageId?: string;
  timestamp: string;
}

export interface TemplateDTO {
  id: string;
  name: string;
  category: string;
  language: string;
  body: string;
  variables: string[];
  approved: boolean;
}

export interface AgentDTO {
  id: string;
  name: string;
  email?: string;
  role: AgentRole;
  active: boolean;
  capacity: number;
}

export interface AuthUser {
  id: string;
  name: string;
  role: AgentRole;
}

export interface WhatsAppWebhookMessage {
  waMessageId: string;
  phone: string;
  name?: string;
  text: string;
  timestamp?: string;
}

export interface NoteDTO {
  id: string;
  leadId: string;
  userId: string;
  body: string;
  createdAt: string;
}

export interface TaskDTO {
  id: string;
  leadId: string;
  title: string;
  description?: string;
  assignedTo?: string;
  dueAt: string;
  status: TaskStatus;
  reminderSent: boolean;
  createdAt: string;
}

// ─── Follow-up Plans ──────────────────────────────────────────────────────────

export interface FollowupStepDTO {
  label: string;
  enabled: boolean;
  messageBody: string;
  delayHours: number;
}

export interface FollowupPlanDTO {
  id: string;
  name: string;
  welcomeMessage: string;
  steps: FollowupStepDTO[];
  isDefault: boolean;
  assignTo?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type EnrollmentStatus = "active" | "stopped" | "completed";
export type StepStatus = "pending" | "sent" | "skipped";

export interface EnrollmentStepDTO {
  stepIndex: number;
  label: string;
  scheduledAt: string;
  sentAt?: string;
  status: StepStatus;
  messageId?: string;
}

export interface FollowupEnrollmentDTO {
  id: string;
  leadId: string;
  planId: string;
  status: EnrollmentStatus;
  enrolledAt: string;
  stoppedAt?: string;
  completedAt?: string;
  steps: EnrollmentStepDTO[];
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export type CampaignType = "promotional" | "marketing" | "follow-up" | "announcement" | "custom";
export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type CampaignAudienceSource = "crm_filters" | "csv";
export type RecipientStatus = "pending" | "sent" | "delivered" | "read" | "replied" | "failed" | "skipped" | "opted_out";

export interface CampaignProgress {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  skipped: number;
}

export interface CampaignFilters {
  stage?: string;
  tags?: string[];
  assignedTo?: string;
  source?: string;
}

export interface CampaignDTO {
  id: string;
  name: string;
  description?: string;
  type: CampaignType;
  status: CampaignStatus;
  audienceSource: CampaignAudienceSource;
  filters?: CampaignFilters;
  recipientCount: number;
  messageBody: string;
  sendAt?: string;
  timezone: string;
  messagesPerMinute: number;
  progress: CampaignProgress;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CampaignRecipientDTO {
  id: string;
  campaignId: string;
  leadId?: string;
  phone: string;
  name?: string;
  customVars?: Record<string, string>;
  messageId?: string;
  status: RecipientStatus;
  error?: string;
  processedAt?: string;
}

export interface CsvPreviewRow {
  phone: string;
  name?: string;
  [key: string]: string | undefined;
}

export interface CsvPreviewResponse {
  valid: CsvPreviewRow[];
  invalid: Array<{ row: number; phone: string; reason: string }>;
  total: number;
}
