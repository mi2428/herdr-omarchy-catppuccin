# Spaces attention counts

Spaces shows `!N` for the number of blocked live agents in a space and `RN` for the number of supervisor workers awaiting review (`herdr.supervised=1` and `herdr.review=pending`). The counts belong to each space, including its nested worktree spaces; they are not Git repository-wide counts. Unpaneled live child terminals reporting `blocked` or `error` count under their parent's space. A worker labeled `reviewing` or `accepted` is not awaiting review.

The Agents panel retains individual agent status, hierarchy and navigation. The separate Worktrees overview panel was removed to avoid repeating those rows.
