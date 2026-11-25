// Organizer helper. Needs the Netlify CLI, logged in and linked to the site:
//   npm i -g netlify-cli && netlify login && netlify link
//
//   npm run votes                         list who has voted (availability poll)
//   npm run remove-vote -- "Mike Jones"   delete that person's vote (any case/spacing)
//   add --poll <id> to either for a different poll
import { spawnSync } from "node:child_process";
import { voteKey } from "../lib/polls.mjs";

const args = process.argv.slice(2);
const pollFlag = args.indexOf("--poll");
const pollId = pollFlag >= 0 ? args.splice(pollFlag, 2)[1] : "availability";
const [cmd, ...rest] = args;

function netlify(cliArgs) {
  const r = spawnSync("netlify", cliArgs, { stdio: "inherit" });
  if (r.error?.code === "ENOENT") {
    console.error("Netlify CLI not found. Install it with: npm i -g netlify-cli  (then: netlify login && netlify link)");
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

if (cmd === "list") {
  netlify(["blobs:list", "votes", "--prefix", `${pollId}/`]);
} else if (cmd === "remove" && rest.length) {
  const name = rest.join(" ");
  const key = voteKey(pollId, name);
  console.log(`Removing vote for "${name}" (key: ${key})`);
  netlify(["blobs:delete", "votes", key, "--force"]);
} else {
  console.log('Usage:\n  npm run votes\n  npm run remove-vote -- "Mike Jones"\n  (add --poll <id> for another poll)');
  process.exit(1);
}
