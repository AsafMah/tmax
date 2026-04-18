export interface WorktreeInfo {
  path: string;
  head: string;
  branch?: string;
  isWorktree: boolean;
  detached?: boolean;
  bare?: boolean;
  locked?: boolean;
  prunable?: boolean;
  // Epoch ms. Filesystem birthtime of the worktree dir - when it was created.
  createdAt?: number;
}

export interface RepoWorktrees {
  gitRoot: string;
  worktrees: WorktreeInfo[];
  isExpanded: boolean;
  error?: string;
}
