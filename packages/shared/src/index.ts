export type LeadStatus = "new" | "contacted" | "interested" | "followup" | "won" | "lost";
export type AgentRole = "admin" | "manager" | "agent";
export type MessageDirection = "in" | "out";
export type MessageType = "text" | "image" | "video" | "document" | "audio" | "template" | "media";
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "retrying" | "waiting_connection";
export type CampaignStatus = "draft" | "scheduled" | "running" | "completed" | "failed";
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

export interface CampaignDTO {
  id: string;
  name: string;
  templateId: string;
  audienceQuery: Record<string, unknown>;
  scheduledAt?: string;
  status: CampaignStatus;
  createdAt: string;
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
