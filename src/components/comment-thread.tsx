import { useState } from "react";
import { addComment } from "#/server/comments";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

interface Comment {
  authorId: string;
  content: string;
  createdAt: Date | string;
  id: string;
  isInternal: boolean | null;
  parentId: string | null;
  projectId: string;
}

interface Props {
  comments: Comment[];
  onChanged: () => void;
  projectId: string;
  viewerIsStaff: boolean;
}

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
          comment={c}
          key={c.id}
          onChanged={onChanged}
          projectId={projectId}
          replies={repliesByParent.get(c.id) ?? []}
          viewerIsStaff={viewerIsStaff}
        />
      ))}
      <NewCommentForm
        onChanged={onChanged}
        projectId={projectId}
        viewerIsStaff={viewerIsStaff}
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
      className={
        isInternal
          ? "rounded-md border-l-4 p-3"
          : "border-border border-l-4 p-3"
      }
      id={`comment-${comment.id}`}
      style={
        isInternal
          ? {
              borderLeftColor: "var(--status-warning)",
              background: "var(--status-warning-bg)",
            }
          : undefined
      }
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span>{comment.authorId.slice(0, 8)}</span>
        <span>{new Date(comment.createdAt).toLocaleString()}</span>
        {isInternal && (
          <span
            className="rounded px-1.5 py-0.5 font-medium text-xs"
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
      <p className="mt-1 whitespace-pre-wrap text-sm">{comment.content}</p>

      {replies.length > 0 && (
        <div className="mt-3 space-y-2 pl-4">
          {replies.map((r) => (
            <div
              className="border-l-2 p-2"
              id={`comment-${r.id}`}
              key={r.id}
              style={
                r.isInternal
                  ? {
                      borderLeftColor: "var(--status-warning)",
                      background: "var(--status-warning-bg)",
                    }
                  : { borderLeftColor: "var(--line)" }
              }
            >
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <span>{r.authorId.slice(0, 8)}</span>
                <span>{new Date(r.createdAt).toLocaleString()}</span>
                {r.isInternal && (
                  <span
                    className="rounded px-1.5 py-0.5 font-medium text-xs"
                    style={{
                      color: "var(--status-warning)",
                    }}
                  >
                    internal
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{r.content}</p>
            </div>
          ))}
        </div>
      )}

      <ReplyForm
        onChanged={onChanged}
        parentId={comment.id}
        projectId={projectId}
        viewerIsStaff={viewerIsStaff}
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
      className="mt-4 space-y-2 border-border border-t pt-4"
      onSubmit={onSubmit}
    >
      <Textarea
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add a comment"
        required
        rows={3}
        value={content}
      />
      {viewerIsStaff && (
        <Label className="font-normal">
          <Checkbox
            checked={isInternal}
            onCheckedChange={(checked) => setIsInternal(checked === true)}
          />
          Internal (staff only)
        </Label>
      )}
      <Button size="sm" type="submit">
        Post comment
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
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
        className="mt-2"
        onClick={() => setOpen(true)}
        size="xs"
        type="button"
        variant="ghost"
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
    <form className="mt-2 space-y-2 pl-4" onSubmit={onSubmit}>
      <Textarea
        onChange={(e) => setContent(e.target.value)}
        placeholder="Reply"
        required
        rows={2}
        value={content}
      />
      {viewerIsStaff && (
        <Label className="font-normal text-xs">
          <Checkbox
            checked={isInternal}
            onCheckedChange={(checked) => setIsInternal(checked === true)}
          />
          Internal (staff only)
        </Label>
      )}
      <div className="flex gap-2">
        <Button size="xs" type="submit">
          Post
        </Button>
        <Button
          onClick={() => setOpen(false)}
          size="xs"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </form>
  );
}
