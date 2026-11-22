# Supervisor overview

The left sidebar shows live Herdr agents, including workers marked `herdr.supervised=1` (an `S` badge). Each row shows the terminal's working folder, its agent or tab title, and Herdr's reported status. Click a row to focus its pane (or peek at an unpaneled terminal). A marked worker also appears while it is starting, before it reports agent status.

Review state is **never inferred from agent status**. A supervisor may set `hc label <terminal> herdr.review=pending` after receiving a worker's result, `herdr.review=reviewing` during review, `herdr.review=accepted` after accepting it, or `herdr.review=` when assigning new work. Without a label, no review state is shown. These labels are presentation hints; the supervisor remains responsible for verifying the work and controlling the worker.

The folder is the terminal's reported cwd, not a Git worktree lookup. A terminal that changes directories can therefore show a different folder. Only agents visible to Herdr app/core are listed; workers started outside it cannot be discovered by this mod. Unmarked agents have no review state even if another process sets a review label.
