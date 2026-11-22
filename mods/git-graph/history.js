// Git supplies commits and parent hashes; this module lays out the visible links.
export function parseHistory(text) {
  return text.split("\x1e").filter(Boolean).map(record => {
    const [hash, parents, seconds, names, title] = record.trimEnd().split("\x1f");
    if (!/^[0-9a-f]{40,64}$/.test(hash) || !/^\d+$/.test(seconds) || names === undefined || title === undefined)
      throw new Error("Unexpected git log output");
    const refs = names.split(", ").flatMap(name => {
      if (name.startsWith("HEAD -> refs/heads/")) return [{ kind: "head", name: name.slice(19) }];
      if (name.startsWith("tag: refs/tags/")) return [{ kind: "tag", name: name.slice(15) }];
      if (name.startsWith("refs/heads/")) return [{ kind: "branch", name: name.slice(11) }];
      if (name.startsWith("refs/remotes/") && !name.endsWith("/HEAD")) return [{ kind: "remote", name: name.slice(13) }];
      return name === "HEAD" ? [{ kind: "head", name }] : [];
    });
    const order = { head: 0, tag: 1, branch: 2, remote: 3 };
    refs.sort((a, b) => order[a.kind] - order[b.kind]);
    return { hash, parents: parents ? parents.split(" ") : [], seconds: Number(seconds), title, refs };
  });
}

// The frontier holds the next ancestor expected in each column, newest first.
// Each link is [start column, start height, end column, end height, color column].
export function graphRows(commits) {
  const frontier = [], rows = [];
  let columns = 1;
  const free = () => { const i = frontier.indexOf(null); return i < 0 ? frontier.length : i; };
  for (const commit of commits) {
    let col = frontier.indexOf(commit.hash);
    const continuing = col >= 0;
    if (!continuing) { col = free(); frontier[col] = commit.hash; }
    const links = [];
    frontier.forEach((hash, i) => {
      if (hash && i !== col) links.push([i, 0, i, 1, i]);
    });
    if (continuing) links.push([col, 0, col, 0.5, col]);
    frontier[col] = null;
    for (const [i, parent] of commit.parents.entries()) {
      let target = frontier.indexOf(parent);
      if (target < 0) { target = i === 0 && frontier[col] === null ? col : free(); frontier[target] = parent; }
      links.push([col, 0.5, target, 1, col]);
    }
    columns = Math.max(columns, frontier.length, col + 1);
    rows.push({ ...commit, col, links });
    while (frontier.at(-1) === null) frontier.pop();
  }
  return { rows, columns };
}

export function worktreeRows(rows, count) {
  if (!count) return rows;
  const head = rows.findIndex(row => row.refs.some(ref => ref.kind === "head"));
  const col = head < 0 ? 0 : rows[head].col;
  return [
    { hash: "worktree", title: `Uncommitted changes (${count})`, worktree: true, worktreeLink: rows.length > 0, refs: [], links: [], col },
    ...rows.map((row, i) => ({ ...row, worktreeLink: head < 0 || i <= head, worktreeCol: col, worktreeTarget: i === head })),
  ];
}

export function countChanges(text) {
  const entries = text.split("\0");
  if (entries.pop() !== "") throw new Error("Unexpected git status output");
  let count = 0;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][2] !== " ") throw new Error("Unexpected git status output");
    count++;
    if (/[RC]/.test(entries[i].slice(0, 2)) && !entries[++i]) throw new Error("Unexpected git status output");
  }
  return count;
}

export function relativeTime(seconds, now = Date.now()) {
  const age = Math.max(0, Math.floor(now / 1000 - seconds));
  if (age < 60) return "now";
  if (age < 3600) return `${Math.floor(age / 60)}m`;
  if (age < 86400) return `${Math.floor(age / 3600)}h`;
  if (age < 2592000) return `${Math.floor(age / 86400)}d`;
  if (age < 31536000) return `${Math.floor(age / 2592000)}mo`;
  return `${Math.floor(age / 31536000)}y`;
}
