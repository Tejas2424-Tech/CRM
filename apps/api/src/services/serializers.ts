import type { AgentDTO, CampaignDTO, LeadDTO, MessageDTO, NoteDTO, TaskDTO, TemplateDTO } from "@crm/shared";
import type { UserDocument } from "../models/User.js";
import type { CampaignDocument } from "../models/Campaign.js";
import type { LeadDocument } from "../models/Lead.js";
import type { MessageDocument } from "../models/Message.js";
import type { NoteDocument } from "../models/Note.js";
import type { TaskDocument } from "../models/Task.js";
import type { TemplateDocument } from "../models/Template.js";

type WithId<T> = T & { _id: { toString(): string } };

export function serializeLead(lead: WithId<LeadDocument>): LeadDTO {
  // Display name priority: saved contact name → WhatsApp pushname → phone number
  const displayName =
    lead.name?.trim() ||
    (lead as any).pushName?.trim() ||
    lead.phone;

  return {
    id: lead._id.toString(),
    phone: lead.phone,
    name: lead.name,
    email: lead.email,
    displayName,
    pushName: (lead as any).pushName,
    profilePic: (lead as any).profilePic ?? undefined,
    status: lead.stage,
    tags: lead.tags,
    assignedTo: lead.assignedTo,
    source: lead.source,
    consent: {
      optedIn: lead.consent.optedIn,
      optedOutAt: lead.consent.optedOutAt?.toISOString(),
      source: lead.consent.source
    },
    unreadCount: lead.unreadCount ?? 0,
    lastInboundAt: lead.lastInboundAt?.toISOString(),
    windowExpiresAt: lead.windowExpiresAt?.toISOString(),
    createdAt: lead.createdAt.toISOString(),
    lastActivity: lead.lastActivity.toISOString()
  };
}

export function serializeMessage(message: WithId<MessageDocument>): MessageDTO {
  return {
    id: message._id.toString(),
    leadId: message.leadId.toString(),
    direction: message.direction,
    type: message.type,
    text: message.content || (message as any).text,
    templateId: message.templateId?.toString(),
    status: message.status,
    waMessageId: message.waMessageId,
    timestamp: message.timestamp.toISOString()
  };
}

export function serializeTemplate(template: WithId<TemplateDocument>): TemplateDTO {
  return {
    id: template._id.toString(),
    name: template.name,
    category: template.category,
    language: template.language,
    body: template.body,
    variables: template.variables,
    approved: template.approved
  };
}

export function serializeCampaign(campaign: WithId<CampaignDocument>): CampaignDTO {
  return {
    id: campaign._id.toString(),
    name: campaign.name,
    templateId: campaign.templateId.toString(),
    audienceQuery: campaign.audienceQuery,
    scheduledAt: campaign.scheduledAt?.toISOString(),
    status: campaign.status,
    createdAt: (campaign as unknown as { createdAt: Date }).createdAt.toISOString()
  };
}

export function serializeUser(user: WithId<UserDocument>): AgentDTO {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    capacity: user.capacity
  };
}

export function serializeNote(note: WithId<NoteDocument>): NoteDTO {
  return {
    id: note._id.toString(),
    leadId: note.leadId.toString(),
    userId: note.userId,
    body: note.body,
    createdAt: note.createdAt.toISOString()
  };
}

export function serializeTask(task: WithId<TaskDocument>): TaskDTO {
  // dueAt is the canonical field; fall back to legacy dueDate for any
  // documents created before the rename migration ran.
  const due = task.dueAt ?? (task as unknown as Record<string, Date>)["dueDate"];
  return {
    id: task._id.toString(),
    leadId: task.leadId.toString(),
    title: task.title,
    description: task.description,
    assignedTo: task.assignedTo,
    dueAt: due?.toISOString() ?? new Date(0).toISOString(),
    status: task.status,
    reminderSent: task.reminderSent,
    createdAt: task.createdAt.toISOString()
  };
}
