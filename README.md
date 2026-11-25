# Bachelor Party Hub

Private, mobile-first site for the bachelor party. **Version 1 is the weekend availability poll.**
Anyone with the link can vote by typing their name. There are no accounts and no passcode.

- Voting again with the same name (ignoring case and extra spaces) **replaces** that person's earlier vote.
- Everyone sees full results: count and names per weekend, the leading weekend(s) highlighted, and every voter's comment.
- Hidden from search engines (`noindex` meta tag + `X-Robots-Tag` header + `robots.txt` disallow, no sitemap).
- Light spam protection: 12 submissions per 10 minutes per connection, a hidden honeypot field, and a cap of 100 voters per poll.

**Stack:** plain HTML/CSS/JS on Netlify, one Netlify Function (`/api/polls/:pollId`), votes stored in Netlify Blobs.
Netlify's free plan covers everything. No other services, API keys or databases.

```
content/site.json            <- THE file to edit: site title, pages, polls, weekend options
src/layout.html              shared page shell (header, nav, footer, link-preview tags)
src/pages/index.html         home page: just {{poll:availability}}
src/static/                  styles.css, poll.js (poll widget), favicon, robots.txt
netlify/functions/polls.mjs  the vote API (GET results, POST vote)
lib/polls.mjs                poll logic: name matching, validation, tallying, rate limit
scripts/build.mjs            builds dist/ from src/ + content/site.json (no dependencies)
scripts/votes.mjs            organizer helper: list / remove votes
tests/                       npm test
```

---

## Deploy (one time, ~10 minutes)

You need a free Netlify account (https://app.netlify.com/signup). Then choose one option.

### Option A: GitHub (recommended: every push redeploys)

1. Put this folder in a **private** GitHub repo.
2. In Netlify: **Add new project → Import an existing project → GitHub**, pick the repo.
   The settings are read from `netlify.toml` (build `npm run build`, publish `dist`). Click **Deploy**.
3. Rename the site to something unguessable: **Project configuration → General → Change project name**, e.g.
   `smoky-bach-7f3k2` → `https://smoky-bach-7f3k2.netlify.app`.
4. Open the link on your phone, cast a test vote, then remove it (see "Remove a vote" below).
5. Text the link to the group.

### Option B: Command line, no GitHub

```bash
npm install
npm install -g netlify-cli
netlify login
netlify deploy --prod
```

The first `deploy` asks to create a new project; pick a team and give it an unguessable name. Run the
same `netlify deploy --prod` command again after any edit.

> Netlify Drop (drag-and-drop a folder) will **not** work, because it doesn't deploy functions.

### Link previews in iMessage/SMS
The preview shows `site.title` and `site.description` from `content/site.json`. iMessage caches
previews, so after changing the text, test with a slightly different URL (e.g. add `?v=2`).

---

## Change the weekend options

Edit `content/site.json` → `polls[0].options`. Each weekend is one line:

```json
{ "id": "2027-08-12", "start": "2027-08-12", "end": "2027-08-15", "note": "Best value so far" }
```

- `start` is the Thursday and `end` is the Sunday. The label ("Thu Aug 12 – Sun Aug 15") is generated from them.
- `note` is the small grey text under the option (optional).
- `id` is what votes are stored under. **Don't change the `id` of a weekend people already voted for**,
  or their votes for it disappear. To remove a weekend, delete its line; votes for it are ignored from then on.
- To add a weekend, add a line with a new `id` (using the Thursday's date is easiest).

Then redeploy (push to GitHub, or `netlify deploy --prod`) and run `npm test`, which checks that every
`start` is a Thursday and every `end` is a Sunday.

**Close the poll** once the weekend is locked: set `"open": false` on the poll. The form is replaced by
"Voting is closed" and the results stay visible.

---

## Remove a vote (junk or duplicate)

Votes are stored in the Netlify Blobs store **`votes`**, one entry per person, keyed by poll + lowercase
name: `availability/mike%20jones` (`%20` is a space).

**From the Netlify website (no tools needed):**
Your project → **Data & Storage → Blobs** → store **votes** → folder **availability** → find the entry → delete it.

**From the command line** (Netlify CLI, after `netlify login` and `netlify link` in this folder):

```bash
npm run votes                          # list who has voted
npm run remove-vote -- "Mike Jones"    # remove one person's vote (any capitalisation/spacing)
```

Results update on the next page load. If two entries are really the same guy under different names
("Mike J" and "Mike Jones"), delete one and ask him to re-vote under the other.

---

## Run locally

```bash
npm install
npm install -g netlify-cli
npm test
npm run dev
```

`npm run dev` builds the site and starts the local server at http://localhost:8888, with a local
throwaway vote store in `.netlify/`. Run `npm run build` again after editing anything in `src/` or
`content/`.

---

## Adding things later

The site is set up so later versions are additions, not rewrites.

### Add another poll (e.g. activities, house)
1. Add a poll to `polls` in `content/site.json` with a new `id`:
   ```json
   {
     "id": "activities",
     "title": "Pick every activity you'd do",
     "intro": "We'll book the top two.",
     "open": true,
     "options": [
       { "id": "clays", "label": "Sporting clays", "short": "Clays", "note": "Iron Mountain, ~15–20 min" },
       { "id": "golf",  "label": "Golf", "short": "Golf", "note": "Sevierville Golf Club, $79–89" }
     ]
   }
   ```
   Non-date options use `label` (shown on the checkbox) and `short` (used in each voter's summary) instead of `start`/`end`.
2. Put `{{poll:activities}}` in any page in `src/pages/`. The same API (`/api/polls/activities`), name
   matching, results and spam limits apply automatically. Votes go in the same `votes` store under
   `activities/…`, so `npm run remove-vote -- "Name" --poll activities` works too.

### Add a page (overview, activities, itinerary, FAQ…)
1. Create `src/pages/overview.html` with the page body (plain HTML; use `<div class="card">…</div>` blocks).
2. Add it to `pages` in `content/site.json`:
   `{ "file": "overview.html", "nav": "Plan", "title": "The plan" }`.
   Once there are two or more pages, a nav bar appears in the header automatically. The page is
   served at `/overview`. The first page in the list should stay `index.html` (the home page).

Next likely steps: an RSVP/travel form (a new function + store, same pattern as `polls.mjs`), a payment
info page, and a small organizer page if the CLI/dashboard route for removing votes gets old.
