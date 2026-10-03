import type { Answer, Comment, EventOption, EventView, Participant } from '@shared/types';
import type { EventRow, EventRows } from '../db/queries';

/** Assemble the JSON the client reads from the rows `fetchEventRows` returns. Pure, so it is unit-tested. */
export function toEventView(
  event: EventRow,
  { options, participants, votes, comments }: EventRows,
  isAdmin: boolean,
): EventView {
  const votesByParticipant = new Map<string, Record<string, Answer>>();
  for (const v of votes) {
    let bucket = votesByParticipant.get(v.participant_id);
    if (!bucket) {
      bucket = {};
      votesByParticipant.set(v.participant_id, bucket);
    }
    bucket[v.option_id] = v.answer;
  }

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    allowSuggestions: event.allow_suggestions === 1,
    createdAt: event.created_at,
    expiresAt: event.expires_at,
    options: options.map((o): EventOption => ({ id: o.id, date: o.date, suggestedBy: o.suggested_by })),
    participants: participants.map((p): Participant => ({
      id: p.id,
      name: p.name,
      nickname: p.name,
      votes: votesByParticipant.get(p.id) ?? {},
      createdAt: p.created_at,
      isOrganiser: p.is_organiser === 1,
    })),
    comments: comments.map((c): Comment => ({
      id: c.id,
      participantId: c.participant_id,
      name: c.name,
      isOrganiser: c.is_organiser === 1,
      body: c.body,
      createdAt: c.created_at,
    })),
    viewer: { isAdmin },
  };
}
