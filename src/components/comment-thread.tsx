import { useState } from "react";
import { addComment } from "#/server/comments";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

type Comment = {
  id: string;
  projectId: string;
  authorId: string;
  parentId: string | null;
  content: string;
  isInternal: boolean | null;
  createdAt: Date | string;
};

type Props = {
  projectId: string;
  comments: Comment[];
  viewerIsStaff: boolean;
  onChanged: () => void;
};

export function CommentThread({
  projectId,
  comments,
  viewerIsStaff,
  onChanged,
}: Props) {
  const topLevel = comments.filter((c) => !c.parentId);
  const repliesByParent = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.parentId) {
      const arr = repliesByParent.get(c.parentId) ?? [];
      arr.push(c);
      repliesByParent.set(c.parentId, arr);
    }
  }

  return (
    <div className="space-y-4">
      {topLevel.map((c) => (
        <CommentNode
          key={c.id}
          comment={c}
          replies={repliesByParent.get(c.id) ?? []}
          projectId={projectId}
          viewerIsStaff={viewerIsStaff}
          onChanged={onChanged}
        />
      ))}
      <NewCommentForm
        projectId={projectId}
        viewerIsStaff={viewerIsStaff}
        onChanged={onChanged}
      />
    </div>
  );
}

function CommentNode({
  comment,
  replies,
  projectId,
  viewerIsStaff,
  onChanged,
}: {
  comment: Comment;
  replies: Comment[];
  projectId: string;
  viewerIsStaff: boolean;
  onChanged: () => void;
}) {
  const isInternal = comment.isInternal ?? false;
  return (
    <div
      id={`comment-${comment.id}`}
      className={
        isInternal
          ? "rounded-md border-l-4 p-3"
          : "border-l-4 border-border p-3"
      }
      style={
        isInternal
          ? {
              borderLeftColor: "var(--status-warning)",
              background: "var(--status-warning-bg)",
            }
          : undefined
      }
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{comment.authorId.slice(0, 8)}</span>
        <span>{new Date(comment.createdAt).toLocaleString()}</span>
        {isInternal && (
          <span
            className="rounded px-1.5 py-0.5 text-xs font-medium"
            style={{
              background: "var(--status-warning-bg)",
              color: "var(--status-warning)",
              border: "1px solid var(--status-warning)",
            }}
          >
            internal
          </span>
        )}
      </div>
      <p className="mt-1 text-sm whitespace-pre-wrap">{comment.content}</p>

      {replies.length > 0 && (
        <div className="mt-3 space-y-2 pl-4">
          {replies.map((r) => (
            <div
              key={r.id}
              id={`comment-${r.id}`}
              className="border-l-2 p-2"
              style={
                r.isInternal
                  ? {
                      borderLeftColor: "var(--status-warning)",
                      background: "var(--status-warning-bg)",
                    }
                  : { borderLeftColor: "var(--line)" }
              }
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{r.authorId.slice(0, 8)}</span>
                <span>{new Date(r.createdAt).toLocaleString()}</span>
                {r.isInternal && (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-medium"
                    style={{
                      color: "var(--status-warning)",
                    }}
                  >
                    internal
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{r.content}</p>
            </div>
          ))}
        </div>
      )}

      <ReplyForm
        projectId={projectId}
        parentId={comment.id}
        viewerIsStaff={viewerIsStaff}
        onChanged={onChanged}
      />
    </div>
  );
}

function NewCommentForm({
  projectId,
  viewerIsStaff,
  onChanged,
}: {
  projectId: string;
  viewerIsStaff: boolean;
  onChanged: () => void;
}) {
  const [content, setContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addComment({ data: { projectId, content, isInternal } });
      setContent("");
      setIsInternal(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 space-y-2 border-t border-border pt-4"
    >
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add a comment"
        required
        rows={3}
      />
      {viewerIsStaff && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isInternal}
            onChange={(e) => setIsInternal(e.target.checked)}
          />
          Internal (staff only)
        </label>
      )}
      <Button type="submit" size="sm">
        Post comment
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

function ReplyForm({
  projectId,
  parentId,
  viewerIsStaff,
  onChanged,
}: {
  projectId: string;
  parentId: string;
  viewerIsStaff: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="mt-2"
        onClick={() => setOpen(true)}
      >
        Reply
      </Button>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addComment({
        data: { projectId, parentId, content, isInternal },
      });
      setContent("");
      setOpen(false);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-2 pl-4">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Reply"
        required
        rows={2}
      />
      {viewerIsStaff && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={isInternal}
            onChange={(e) => setIsInternal(e.target.checked)}
          />
          Internal (staff only)
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="xs">
          Post
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
