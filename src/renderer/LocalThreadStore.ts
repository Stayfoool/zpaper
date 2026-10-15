// Local (single-user) comment threads for zpaper — a ThreadStore backed by
// localStorage so comments survive reloads without a collaboration server.
import {
  DefaultThreadStoreAuth,
  ThreadStore,
  type CommentData,
  type CommentReactionData,
  type ThreadData,
} from "@blocknote/core/comments";

const STORAGE_KEY = "zpaper:comment-threads";

type StoredThreads = Record<string, ThreadData>;

function load(): Map<string, ThreadData> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as StoredThreads;
    const map = new Map<string, ThreadData>();
    for (const [id, thread] of Object.entries(obj)) {
      // revive Dates that JSON turned into strings
      thread.comments.forEach((c) => {
        c.createdAt = new Date(c.createdAt);
        c.updatedAt = new Date(c.updatedAt);
        c.reactions?.forEach(
          (r) => (r.createdAt = new Date(r.createdAt)),
        );
      });
      map.set(id, thread);
    }
    return map;
  } catch {
    return new Map();
  }
}

export const LOCAL_USER_ID = "local-user";

export function createLocalThreadStore(): ThreadStore {
  const threads = load();
  const listeners = new Set<(threads: Map<string, ThreadData>) => void>();
  const auth = new DefaultThreadStoreAuth(LOCAL_USER_ID, "editor");

  const persist = () => {
    try {
      const obj: StoredThreads = {};
      threads.forEach((t, id) => (obj[id] = t));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // storage full / unavailable — comments stay in memory for the session
    }
  };

  const notify = () => {
    const snapshot = new Map(threads);
    listeners.forEach((cb) => cb(snapshot));
  };

  const now = () => new Date();

  // cast the base: `addThreadToDocument` is an optional abstract member and
  // TS demands an implementation — but the default (TipTap mark creation) is
  // exactly what we want, so the method must stay undefined on the prototype
  class LocalThreadStore extends (ThreadStore as any) {
    createThread(options: {
      initialComment: { body: any; metadata?: any };
      metadata?: any;
    }): Promise<ThreadData> {
      const id = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const comment: CommentData = {
        type: "comment",
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        userId: LOCAL_USER_ID,
        createdAt: now(),
        updatedAt: now(),
        reactions: [] as CommentReactionData[],
        metadata: options.initialComment.metadata ?? {},
        body: options.initialComment.body,
      };
      const thread: ThreadData = {
        type: "thread",
        id,
        createdAt: now(),
        updatedAt: now(),
        comments: [comment],
        resolved: false,
        metadata: options.metadata ?? {},
      };
      threads.set(id, thread);
      persist();
      notify();
      return Promise.resolve(thread);
    }

    addComment(options: {
      comment: { body: any; metadata?: any };
      threadId: string;
    }): Promise<CommentData> {
      const thread = threads.get(options.threadId)!;
      const comment: CommentData = {
        type: "comment",
        id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        userId: LOCAL_USER_ID,
        createdAt: now(),
        updatedAt: now(),
        reactions: [],
        metadata: options.comment.metadata ?? {},
        body: options.comment.body,
      };
      thread.comments.push(comment);
      persist();
      notify();
      return Promise.resolve(comment);
    }

    updateComment(options: {
      comment: { body: any; metadata?: any };
      threadId: string;
      commentId: string;
    }): Promise<void> {
      const thread = threads.get(options.threadId)!;
      const comment = thread.comments.find((c) => c.id === options.commentId)!;
      comment.body = options.comment.body;
      comment.updatedAt = now();
      persist();
      notify();
      return Promise.resolve();
    }

    deleteComment(options: { threadId: string; commentId: string }): Promise<void> {
      const thread = threads.get(options.threadId)!;
      thread.comments = thread.comments.filter((c) => c.id !== options.commentId);
      if (thread.comments.length === 0) {
        threads.delete(options.threadId);
      }
      persist();
      notify();
      return Promise.resolve();
    }

    deleteThread(options: { threadId: string }): Promise<void> {
      threads.delete(options.threadId);
      persist();
      notify();
      return Promise.resolve();
    }

    resolveThread(options: { threadId: string }): Promise<void> {
      const thread = threads.get(options.threadId)!;
      thread.resolved = true;
      thread.resolvedUpdatedAt = now();
      thread.resolvedBy = LOCAL_USER_ID;
      persist();
      notify();
      return Promise.resolve();
    }

    unresolveThread(options: { threadId: string }): Promise<void> {
      const thread = threads.get(options.threadId)!;
      thread.resolved = false;
      thread.resolvedUpdatedAt = undefined;
      thread.resolvedBy = undefined;
      persist();
      notify();
      return Promise.resolve();
    }

    addReaction(options: {
      threadId: string;
      commentId: string;
      emoji: string;
    }): Promise<void> {
      const thread = threads.get(options.threadId)!;
      const comment = thread.comments.find((c) => c.id === options.commentId)!;
      comment.reactions ??= [];
      const existing = comment.reactions.find((r) => r.emoji === options.emoji);
      if (existing) {
        if (!existing.userIds.includes(LOCAL_USER_ID)) {
          existing.userIds.push(LOCAL_USER_ID);
        }
      } else {
        comment.reactions.push({
          emoji: options.emoji,
          createdAt: now(),
          userIds: [LOCAL_USER_ID],
        });
      }
      persist();
      notify();
      return Promise.resolve();
    }

    deleteReaction(options: {
      threadId: string;
      commentId: string;
      emoji: string;
    }): Promise<void> {
      const thread = threads.get(options.threadId)!;
      const comment = thread.comments.find((c) => c.id === options.commentId)!;
      const reaction = comment.reactions?.find((r) => r.emoji === options.emoji);
      if (reaction) {
        reaction.userIds = reaction.userIds.filter((u) => u !== LOCAL_USER_ID);
        if (reaction.userIds.length === 0) {
          comment.reactions = comment.reactions!.filter(
            (r) => r.emoji !== options.emoji,
          );
        }
      }
      persist();
      notify();
      return Promise.resolve();
    }

    getThread(threadId: string): ThreadData {
      return threads.get(threadId)!;
    }

    getThreads(): Map<string, ThreadData> {
      return new Map(threads);
    }

    subscribe(cb: (threads: Map<string, ThreadData>) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }
  }

  const store = new (LocalThreadStore as any)(auth);
  return store as ThreadStore;
}
