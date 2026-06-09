import type { AgentDTO, CampaignDTO, CampaignRecipientDTO, FollowupEnrollmentDTO, FollowupPlanDTO, LeadDTO, MessageDTO, NoteDTO, TaskDTO, TemplateDTO } from "@crm/shared";
import type { UserDocument } from "../models/User.js";
import type { LeadDocument } from "../models/Lead.js";
import type { MessageDocument } from "../models/Message.js";
import type { NoteDocument } from "../models/Note.js";
import type { TaskDocument } from "../models/Task.js";
import type { TemplateDocument } from "../models/Template.js";
import type { FollowupPlanDocument } from "../models/FollowupPlan.js";
import type { FollowupEnrollmentDocument } from "../models/FollowupEnrollment.js";
import type { CampaignDocument } from "../models/Campaign.js";
import type { CampaignRecipientDocument } from "../models/CampaignRecipient.js";

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
    dueAt: due?.toISOString() ?? new Date().toISOString(),
    status: task.status,
    reminderSent: task.reminderSent,
    createdAt: task.createdAt.toISOString()
  };
}

export function serializeFollowupPlan(plan: WithId<FollowupPlanDocument>): FollowupPlanDTO {
  return {
    id: plan._id.toString(),
    name: plan.name,
    welcomeMessage: plan.welcomeMessage,
    steps: plan.steps.map((s) => ({
      label: s.label,
      enabled: s.enabled,
      messageBody: s.messageBody,
      delayHours: s.delayHours
    })),
    isDefault: plan.isDefault,
    assignTo: plan.assignTo,
    createdBy: plan.createdBy,
    createdAt: (plan as any).createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: (plan as any).updatedAt?.toISOString() ?? new Date().toISOString()
  };
}

export function serializeEnrollment(
  enrollment: WithId<FollowupEnrollmentDocument>
): FollowupEnrollmentDTO {
  return {
    id: enrollment._id.toString(),
    leadId: enrollment.leadId.toString(),
    planId: enrollment.planId.toString(),
    status: enrollment.status,
    enrolledAt: enrollment.enrolledAt.toISOString(),
    stoppedAt: enrollment.stoppedAt?.toISOString(),
    completedAt: enrollment.completedAt?.toISOString(),
    steps: enrollment.steps.map((s) => ({
      stepIndex: s.stepIndex,
      label: s.label,
      scheduledAt: s.scheduledAt.toISOString(),
      sentAt: s.sentAt?.toISOString(),
      status: s.status,
      messageId: s.messageId
    }))
  };
}

export function serializeCampaign(campaign: WithId<CampaignDocument>): CampaignDTO {
  return {
    id: campaign._id.toString(),
    name: campaign.name,
    description: campaign.description,
    type: campaign.type,
    status: campaign.status,
    audienceSource: campaign.audienceSource,
    filters: campaign.filters
      ? {
          stage: campaign.filters.stage,
          tags: campaign.filters.tags,
          assignedTo: campaign.filters.assignedTo,
          source: campaign.filters.source
        }
      : undefined,
    recipientCount: campaign.recipientCount,
    messageBody: campaign.messageBody,
    sendAt: campaign.sendAt?.toISOString(),
    timezone: campaign.timezone,
    messagesPerMinute: campaign.messagesPerMinute,
    progress: { ...campaign.progress },
    createdBy: campaign.createdBy,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    startedAt: campaign.startedAt?.toISOString(),
    completedAt: campaign.completedAt?.toISOString()
  };
}

export function serializeCampaignRecipient(
  r: WithId<CampaignRecipientDocument>
): CampaignRecipientDTO {
  return {
    id: r._id.toString(),
    campaignId: r.campaignId.toString(),
    leadId: r.leadId?.toString(),
    phone: r.phone,
    name: r.name,
    customVars: r.customVars as Record<string, string> | undefined,
    messageId: r.messageId?.toString(),
    status: r.status,
    error: r.error,
    processedAt: r.processedAt?.toISOString()
  };
}
