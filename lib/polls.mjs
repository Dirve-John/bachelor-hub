// Poll logic with no Netlify dependencies, so it can be unit-tested.
// A "store" is anything with get(key, {type:"json"}), setJSON(key, value), list({prefix}).

export const LIMITS = {
  nameMax: 40,
  commentMax: 300,
  votersPerPoll: 100, // safety cap so a forwarded link can't flood the results
  postsPerWindow: 12, // per IP
  windowMs: 10 * 60 * 1000,
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad date "${iso}" in content/site.json (use YYYY-MM-DD)`);
  return d;
}

/** "Thu Jul 22 – Sun Jul 25" */
export function longLabel(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);
  const fmt = (d) => `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${fmt(a)} – ${fmt(b)}`;
}

/** "Jul 22–25" or "Jul 29–Aug 1" */
export function shortLabel(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);
  const left = `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}`;
  const right =
    a.getUTCMonth() === b.getUTCMonth() ? `${b.getUTCDate()}` : `${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`;
  return `${left}–${right}`;
}

/** Public shape of a poll: computed labels, no internal fields. */
export function describePoll(poll) {
  return {
    id: poll.id,
    title: poll.title,
    intro: poll.intro ?? "",
    open: poll.open !== false,
    commentPrompt: poll.commentPrompt ?? "Comment (optional)",
    commentPlaceholder: poll.commentPlaceholder ?? "",
    options: poll.options.map((o) => ({
      id: o.id,
      label: o.label ?? (o.start && o.end ? longLabel(o.start, o.end) : o.id),
      short: o.short ?? (o.start && o.end ? shortLabel(o.start, o.end) : o.label ?? o.id),
      note: o.note ?? "",
    })),
  };
}

export function findPoll(content, pollId) {
  return content.polls.find((p) => p.id === pollId) ?? null;
}

/** Collapse whitespace and trim. This is the name we display. */
export function cleanName(raw) {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same person = same name ignoring case and extra spaces. */
export function nameKey(raw) {
  return cleanName(raw).toLowerCase();
}

/** Blob key for one person's vote in one poll, e.g. "availability/mike%20jones". */
export function voteKey(pollId, rawName) {
  return `${pollId}/${encodeURIComponent(nameKey(rawName))}`;
}

export class VoteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Validate a submission. Returns {name, choices, comment} or throws VoteError. */
export function validateVote(poll, body) {
  if (!body || typeof body !== "object") throw new VoteError("Invalid request.");
  const name = cleanName(body.name);
  if (!name) throw new VoteError("Please enter your name.");
  if (name.length > LIMITS.nameMax) throw new VoteError(`Name must be ${LIMITS.nameMax} characters or fewer.`);
  if (!/\p{L}/u.test(name)) throw new VoteError("Please enter a real name.");

  if (!Array.isArray(body.choices)) throw new VoteError("Invalid choices.");
  const valid = new Set(poll.options.map((o) => o.id));
  const choices = [];
  for (const c of body.choices) {
    if (!valid.has(c)) throw new VoteError("One of the selected options no longer exists. Refresh and try again.");
    if (!choices.includes(c)) choices.push(c);
  }
  // Keep choices in the same order as the options list.
  choices.sort((x, y) => poll.options.findIndex((o) => o.id === x) - poll.options.findIndex((o) => o.id === y));

  const comment = String(body.comment ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .trim();
  if (comment.length > LIMITS.commentMax)
    throw new VoteError(`Comment must be ${LIMITS.commentMax} characters or fewer.`);

  return { name, choices, comment };
}

/** Load every vote for a poll. */
export async function loadVotes(store, pollId) {
  const { blobs } = await store.list({ prefix: `${pollId}/` });
  const votes = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return votes.filter(Boolean);
}

/** Save (insert or update) a vote. Returns {updated: boolean}. */
export async function saveVote(store, poll, vote, now = new Date()) {
  const key = voteKey(poll.id, vote.name);
  const existing = await store.get(key, { type: "json" });
  if (!existing) {
    const { blobs } = await store.list({ prefix: `${poll.id}/` });
    if (blobs.length >= LIMITS.votersPerPoll) {
      throw new VoteError("This poll has reached its voter limit. Text the organizer.", 409);
    }
  }
  const record = {
    name: vote.name,
    choices: vote.choices,
    comment: vote.comment,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await store.setJSON(key, record);
  return { updated: Boolean(existing), record };
}

/** Tally votes into the public results shape. */
export function tally(poll, votes) {
  const publicPoll = describePoll(poll);
  const validIds = new Set(publicPoll.options.map((o) => o.id));
  const voters = votes
    .map((v) => ({
      name: v.name,
      choices: (v.choices ?? []).filter((c) => validIds.has(c)),
      comment: v.comment ?? "",
      updatedAt: v.updatedAt ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const options = publicPoll.options.map((o) => {
    const names = voters.filter((v) => v.choices.includes(o.id)).map((v) => v.name);
    return { ...o, count: names.length, names };
  });
  const max = Math.max(0, ...options.map((o) => o.count));
  const topOptionIds = max > 0 ? options.filter((o) => o.count === max).map((o) => o.id) : [];

  return { poll: { ...publicPoll, options }, totalVoters: voters.length, topOptionIds, voters };
}

/**
 * Light per-IP rate limit. Not atomic, which is fine for a 17-person poll;
 * it just stops someone from hammering the endpoint.
 */
export async function checkRateLimit(store, ipHash, now = Date.now()) {
  if (!ipHash) return true;
  const key = `ip/${ipHash}`;
  const entry = (await store.get(key, { type: "json" })) ?? { windowStart: now, count: 0 };
  const fresh = now - entry.windowStart > LIMITS.windowMs ? { windowStart: now, count: 0 } : entry;
  if (fresh.count >= LIMITS.postsPerWindow) return false;
  await store.setJSON(key, { windowStart: fresh.windowStart, count: fresh.count + 1 });
  return true;
}
