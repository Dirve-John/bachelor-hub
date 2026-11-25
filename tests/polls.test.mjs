import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  longLabel, shortLabel, nameKey, cleanName, voteKey, validateVote, saveVote, loadVotes, tally,
  checkRateLimit, findPoll, describePoll, LIMITS, VoteError,
} from "../lib/polls.mjs";

const content = JSON.parse(readFileSync(new URL("../content/site.json", import.meta.url), "utf8"));
const poll = findPoll(content, "availability");

function memoryStore() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, structuredClone(v)); },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}

test("content: every weekend is Thursday to Sunday, ids unique", () => {
  const ids = new Set();
  for (const o of poll.options) {
    assert.ok(!ids.has(o.id), `duplicate id ${o.id}`);
    ids.add(o.id);
    assert.equal(new Date(`${o.start}T00:00:00Z`).getUTCDay(), 4, `${o.start} is not a Thursday`);
    assert.equal(new Date(`${o.end}T00:00:00Z`).getUTCDay(), 0, `${o.end} is not a Sunday`);
  }
  assert.equal(poll.options.length, 7);
  assert.ok(!ids.has("2027-08-19"), "Aug 19–22 is intentionally excluded");
});

test("labels", () => {
  assert.equal(longLabel("2027-07-22", "2027-07-25"), "Thu Jul 22 – Sun Jul 25");
  assert.equal(longLabel("2027-07-29", "2027-08-01"), "Thu Jul 29 – Sun Aug 1");
  assert.equal(shortLabel("2027-07-22", "2027-07-25"), "Jul 22–25");
  assert.equal(shortLabel("2027-07-29", "2027-08-01"), "Jul 29–Aug 1");
  assert.deepEqual(describePoll(poll).options.map((o) => o.label), [
    "Thu Jul 22 – Sun Jul 25", "Thu Jul 29 – Sun Aug 1", "Thu Aug 5 – Sun Aug 8", "Thu Aug 12 – Sun Aug 15",
    "Thu Aug 26 – Sun Aug 29", "Thu Sep 2 – Sun Sep 5", "Thu Sep 9 – Sun Sep 12",
  ]);
});

test("names: same person ignoring case and extra spaces", () => {
  assert.equal(cleanName("  Mike   Jones "), "Mike Jones");
  assert.equal(nameKey("  mike   JONES "), nameKey("Mike Jones"));
  assert.equal(voteKey("availability", " MIKE  jones"), "availability/mike%20jones");
  assert.notEqual(nameKey("Mike Jones"), nameKey("Mike Jone"));
});

test("validation", () => {
  const ok = validateVote(poll, { name: " Dave ", choices: ["2027-08-12", "2027-07-22", "2027-08-12"], comment: " hi " });
  assert.deepEqual(ok, { name: "Dave", choices: ["2027-07-22", "2027-08-12"], comment: "hi" });
  assert.deepEqual(validateVote(poll, { name: "Dave", choices: [] }).choices, []);
  assert.throws(() => validateVote(poll, { name: "   ", choices: [] }), VoteError);
  assert.throws(() => validateVote(poll, { name: "1234", choices: [] }), VoteError);
  assert.throws(() => validateVote(poll, { name: "x".repeat(41), choices: [] }), VoteError);
  assert.throws(() => validateVote(poll, { name: "Dave", choices: ["2027-08-19"] }), VoteError);
  assert.throws(() => validateVote(poll, { name: "Dave", choices: "2027-08-12" }), VoteError);
  assert.throws(() => validateVote(poll, { name: "Dave", choices: [], comment: "x".repeat(301) }), VoteError);
});

test("re-voting with the same name updates instead of duplicating", async () => {
  const store = memoryStore();
  const t1 = new Date("2026-12-01T00:00:00Z");
  const r1 = await saveVote(store, poll, validateVote(poll, { name: "Mike Jones", choices: ["2027-08-05"], comment: "" }), t1);
  assert.equal(r1.updated, false);
  const r2 = await saveVote(store, poll, validateVote(poll, { name: "  mike  JONES", choices: ["2027-08-12"], comment: "changed" }));
  assert.equal(r2.updated, true);
  await saveVote(store, poll, validateVote(poll, { name: "Chris", choices: ["2027-08-12", "2027-09-09"], comment: "" }));

  const votes = await loadVotes(store, "availability");
  assert.equal(votes.length, 2);
  const mike = votes.find((v) => nameKey(v.name) === "mike jones");
  assert.deepEqual(mike.choices, ["2027-08-12"]);
  assert.equal(mike.comment, "changed");
  assert.equal(mike.name, "mike JONES", "display name follows the latest submission");
  assert.equal(mike.createdAt, t1.toISOString());
});

test("tally: counts, names, top weekend(s), voters sorted", async () => {
  const votes = [
    { name: "Zed", choices: ["2027-08-12", "2027-08-05"], comment: "Fri–Sun only" },
    { name: "amy", choices: ["2027-08-12"], comment: "" },
    { name: "Bob", choices: ["2027-08-05", "gone-option"], comment: "" },
  ];
  const r = tally(poll, votes);
  assert.equal(r.totalVoters, 3);
  assert.deepEqual(r.voters.map((v) => v.name), ["amy", "Bob", "Zed"]);
  const byId = Object.fromEntries(r.poll.options.map((o) => [o.id, o]));
  assert.equal(byId["2027-08-12"].count, 2);
  assert.deepEqual(byId["2027-08-12"].names, ["amy", "Zed"]);
  assert.equal(byId["2027-08-05"].count, 2);
  assert.deepEqual(r.topOptionIds, ["2027-08-05", "2027-08-12"], "ties are all highlighted");
  assert.deepEqual(r.voters[1].choices, ["2027-08-05"], "removed options are dropped");
  assert.deepEqual(tally(poll, []).topOptionIds, []);
});

test("voter cap blocks new names but still allows updates", async () => {
  const store = memoryStore();
  for (let i = 0; i < LIMITS.votersPerPoll; i++) store.m.set(`availability/p${i}`, { name: `P${i}`, choices: [] });
  store.m.set("availability/existing", { name: "existing", choices: [] });
  store.m.delete("availability/p0");
  await assert.rejects(saveVote(store, poll, { name: "Newbie", choices: [], comment: "" }), VoteError);
  await saveVote(store, poll, { name: "Existing", choices: ["2027-08-12"], comment: "" });
});

test("rate limit", async () => {
  const store = memoryStore();
  const t = 1_000_000;
  for (let i = 0; i < LIMITS.postsPerWindow; i++) assert.equal(await checkRateLimit(store, "abc", t + i), true);
  assert.equal(await checkRateLimit(store, "abc", t + 100), false);
  assert.equal(await checkRateLimit(store, "other", t + 100), true);
  assert.equal(await checkRateLimit(store, "abc", t + LIMITS.windowMs + 1), true, "window resets");
});
