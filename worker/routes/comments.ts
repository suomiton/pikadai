import { Hono } from 'hono';
import { LIMITS } from '@shared/limits';
import { createCommentSchema } from '@shared/schemas';
import type { Comment } from '@shared/types';
import type { AppEnv } from '../env';
import { countComments, getParticipant, insertComment } from '../db/queries';
import { bearerToken, isParticipantOwner, loadEvent, PARTICIPANT_ID_HEADER } from '../lib/auth';
import { randomId } from '../lib/crypto';
import { errors, parseBody, readJson } from '../lib/http';
import { rateLimit } from '../lib/ratelimit';

/** Mounted at /api/events/:id/comments */
export const comments = new Hono<AppEnv>();

comments.post(
  '/',
  rateLimit((env) => env.WRITE_LIMITER),
  async (c) => {
    const event = await loadEvent(c.env.DB, c.req.param('id'));

    // Only a participant may comment, under their own nickname; the admin token alone is not enough.
    const participantId = c.req.header(PARTICIPANT_ID_HEADER);
    const participant = participantId ? await getParticipant(c.env.DB, event.id, participantId) : null;
    if (!participant || !(await isParticipantOwner(bearerToken(c.req.header('Authorization')), participant))) {
      throw errors.forbidden('Join the poll with a nickname before commenting', 'not_participant');
    }

    const body = parseBody(createCommentSchema, await readJson(c));

    if ((await countComments(c.env.DB, event.id)) >= LIMITS.commentsMax) {
      throw errors.conflict(`This poll already has the maximum of ${LIMITS.commentsMax} comments`, 'too_many_comments');
    }

    const now = Date.now();
    const comment = {
      id: randomId(),
      event_id: event.id,
      participant_id: participant.id,
      body: body.body,
      created_at: now,
    };
    // One comment per interval per participant, decided by the insert itself so a race cannot slip through.
    if (!(await insertComment(c.env.DB, comment, now - LIMITS.commentIntervalMs))) {
      throw errors.tooMany('Wait a few seconds before commenting again', 'comment_too_soon');
    }

    return c.json(
      {
        id: comment.id,
        participantId: participant.id,
        nickname: participant.nickname,
        isOrganiser: participant.is_organiser === 1,
        body: comment.body,
        createdAt: now,
      } satisfies Comment,
      201,
    );
  },
);
