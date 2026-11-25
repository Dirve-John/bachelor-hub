// GET  /api/polls/:pollId  -> poll definition + full results (public)
// POST /api/polls/:pollId  -> {name, choices[], comment} ; same name (any case/spacing) updates the earlier vote
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import content from "../../content/site.json" with { type: "json" };
import { findPoll, validateVote, saveVote, loadVotes, tally, checkRateLimit, VoteError } from "../../lib/polls.mjs";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });

export default async (req, context) => {
  const poll = findPoll(content, context.params.pollId);
  if (!poll) return json(404, { error: "Poll not found." });

  const votes = getStore({ name: "votes", consistency: "strong" });

  try {
    if (req.method === "GET") {
      return json(200, tally(poll, await loadVotes(votes, poll.id)));
    }

    if (req.method === "POST") {
      if (poll.open === false) throw new VoteError("This poll is closed.", 403);

      let body;
      try {
        body = await req.json();
      } catch {
        throw new VoteError("Invalid request.");
      }

      // Honeypot: a hidden field real people never fill in.
      if (body && body.website) return json(200, tally(poll, await loadVotes(votes, poll.id)));

      const limits = getStore({ name: "ratelimit", consistency: "strong" });
      const ipHash = context.ip ? createHash("sha256").update(`bach:${context.ip}`).digest("hex").slice(0, 32) : null;
      if (!(await checkRateLimit(limits, ipHash))) {
        throw new VoteError("Too many submissions from this connection. Try again in a few minutes.", 429);
      }

      const vote = validateVote(poll, body);
      const { updated } = await saveVote(votes, poll, vote);
      return json(200, { ok: true, updated, name: vote.name, ...tally(poll, await loadVotes(votes, poll.id)) });
    }

    return json(405, { error: "Method not allowed." });
  } catch (err) {
    if (err instanceof VoteError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: "Something went wrong. Try again in a minute." });
  }
};

export const config = { path: "/api/polls/:pollId" };
