import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../mods/git-graph/history.js", import.meta.url), "utf8");
const { parseHistory, graphRows } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const [merge, branch, trunk, base] = "abcd".split("").map(c => c.repeat(40));
const text = [
  `${merge}\x1f${trunk} ${branch}\x1f1795270868\x1fHEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1\x1fMerge branch`,
  `${branch}\x1f${base}\x1f1795270800\x1frefs/heads/feature\x1fFeature`,
  `${trunk}\x1f${base}\x1f1795270700\x1f\x1fTrunk`,
  `${base}\x1f\x1f1795270600\x1f\x1fBase`,
].map(s => `\x1e${s}\n`).join("");
const commits = parseHistory(text);
assert.equal(commits[0].title, "Merge branch");
assert.equal(commits[0].seconds, 1795270868);
assert.deepEqual(commits[0].refs, [
  { kind: "head", name: "main" }, { kind: "tag", name: "v1" }, { kind: "remote", name: "origin/main" },
]);
assert.deepEqual(commits[1].refs, [{ kind: "branch", name: "feature" }]);
const { rows, columns } = graphRows(commits);
assert.equal(columns, 2);
assert.deepEqual(rows.map(row => row.col), [0, 1, 0, 1]);
assert.ok(rows[0].links.some(([a, , b]) => a === 0 && b === 1));
assert.ok(rows[2].links.some(([a, , b]) => a === 0 && b === 1));
assert.throws(() => parseHistory("\x1einvalid\x1f\x1f0\x1f\x1fTitle"), /Unexpected git log output/);
