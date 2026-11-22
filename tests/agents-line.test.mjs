import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/agents-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("const taskTitle =");
const end = source.indexOf("\nconst RANK", start);
assert.ok(start >= 0 && end > start);
const agentLine = runInNewContext(`${source.slice(start, end).replace("export ", "")}\nagentLine`);
const a = { address: "t1", space_name: "repo", program: { name: "Codex" } };
const b = { ...a, address: "t2" };
assert.deepEqual({ ...agentLine(a, { branch: "feature", cwd: "/repo" }, "Review changes") },
  { place: "repo", branch: "feature", task: "Review changes", id: "t1" });
assert.deepEqual({ ...agentLine(b, { branch: "feature", cwd: "/repo" }, "Adversarial QA") },
  { place: "repo", branch: "feature", task: "Adversarial QA", id: "t2" });
assert.deepEqual({ ...agentLine(b, { branch: null, cwd: "/repo" }, "2") },
  { place: "repo", branch: null, task: "Codex", id: "t2" });
assert.deepEqual({ ...agentLine(a, { branch: "main", cwd: "/work/repo" }, "π > repo") },
  { place: "repo", branch: "main", task: "No task title", id: "t1" });
assert.equal(agentLine(a, { cwd: "/work/repo" }, "π > Review changes").task, "π > Review changes");
