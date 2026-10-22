import { z } from 'zod';

export const createTeamInputSchema = z.object({
  name: z.string().trim().min(2).max(32),
  /** Каких ролей не хватает: капитаны ориентируются на это в драфте, авто-пик тоже. */
  missingRoles: z.array(z.string()).max(5).default([]),
});
export type CreateTeamInput = z.infer<typeof createTeamInputSchema>;

export const joinTeamInputSchema = z.object({
  inviteCode: z.string().trim().min(6).max(16),
});

export const draftPickInputSchema = z.object({
  userId: z.uuid(),
});

export const DRAFT_PICK_SECONDS = 60;

export const DRAFT_STATUSES = ['in_progress', 'finished'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const FREE_AGENT_STATUSES = ['pool', 'picked', 'reserve'] as const;
export type FreeAgentStatus = (typeof FREE_AGENT_STATUSES)[number];
