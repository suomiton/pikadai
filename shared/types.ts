import type { z } from 'zod';
import type { answerSchema } from './schemas';

/** One of yes, no, maybe; the schema is the single definition. */
export type Answer = z.infer<typeof answerSchema>;

export interface EventOption {
  id: string;
  /** ISO calendar date, YYYY-MM-DD. */
  date: string;
  /** Participant id of whoever suggested the date, or null if the creator added it. */
  suggestedBy: string | null;
}

export interface Participant {
  id: string;
  name: string;
  votes: Record<string, Answer>;
  createdAt: number;
  /** Joined with the admin token: the organiser's own row. Shown with a pill after the name. */
  isOrganiser: boolean;
}

/** A comment, posted under a participant's name; the name follows the participant's current one. */
export interface Comment {
  id: string;
  participantId: string;
  name: string;
  /** The author is the organiser's row; see `Participant.isOrganiser`. */
  isOrganiser: boolean;
  body: string;
  createdAt: number;
}

export interface EventView {
  id: string;
  title: string;
  description: string;
  allowSuggestions: boolean;
  createdAt: number;
  expiresAt: number;
  options: EventOption[];
  participants: Participant[];
  /** Oldest first. */
  comments: Comment[];
  viewer: { isAdmin: boolean };
}

/** Names the Turnstile widget is rendered with; the Worker requires the matching one in siteverify. */
export type TurnstileAction = 'create' | 'answer';

export interface TicketResponse {
  ticket: string;
  /** How long the client must hold the ticket before creating; younger tickets are rejected. */
  minAgeMs: number;
}

export interface CreateEventResponse {
  id: string;
  adminToken: string;
}

export interface CreateParticipantResponse {
  id: string;
  editToken: string;
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
