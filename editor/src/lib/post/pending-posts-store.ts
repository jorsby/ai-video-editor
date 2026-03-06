const STORAGE_KEY = 'jorsby_pending_posts';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface PendingPost {
  postUuid: string;
  accountNames: string[];
  savedAt: number; // epoch ms
}

function read(): PendingPost[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PendingPost[];
  } catch {
    return [];
  }
}

function write(posts: PendingPost[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
  } catch {
    // Storage quota exceeded — fail silently
  }
}

export function savePendingPost(
  postUuid: string,
  accountNames: string[]
): void {
  const posts = read().filter((p) => p.postUuid !== postUuid); // deduplicate
  posts.push({ postUuid, accountNames, savedAt: Date.now() });
  write(posts);
}

export function getPendingPosts(): PendingPost[] {
  const now = Date.now();
  return read().filter((p) => now - p.savedAt < MAX_AGE_MS);
}

export function removePendingPost(postUuid: string): void {
  write(read().filter((p) => p.postUuid !== postUuid));
}
