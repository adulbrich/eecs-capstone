import { describe, expect, it } from "vitest";
import {
  commentNotifications,
  softDeleteNotification,
  statusChangeNotification,
} from "../project-notifications";

const project = {
  id: "p-1",
  proposerId: "u-proposer" as string | null,
  title: "Fish ladder telemetry",
};

const comment = {
  authorId: "u-staff",
  content: "Looks good.",
  id: "c-1",
  isInternal: false as boolean | null,
  parentId: null as string | null,
};

describe("statusChangeNotification", () => {
  it("tells the proposer, and links to the project", () => {
    const row = statusChangeNotification(project, "approved", "u-staff");
    expect(row?.userId).toBe("u-proposer");
    expect(row?.type).toBe("status_change");
    expect(row?.title).toBe(
      "Your project 'Fish ladder telemetry' is now approved"
    );
    expect(row?.message).toBe("Status changed to approved.");
    expect(row?.link).toBe("/projects/p-1");
  });

  it("says nothing when the proposer is the one who acted", () => {
    // A proposer submitting their own project is the only person to tell, so
    // there is nobody to tell. The whole of the silence rule.
    expect(
      statusChangeNotification(project, "submitted", "u-proposer")
    ).toBeNull();
  });

  it("says nothing when the project has no proposer", () => {
    expect(
      statusChangeNotification(
        { ...project, proposerId: null },
        "approved",
        "u-staff"
      )
    ).toBeNull();
  });

  it("changes_requested gets its own title and quotes the comment", () => {
    const row = statusChangeNotification(
      project,
      "changes_requested",
      "u-staff",
      "  Tighten the objectives.  "
    );
    expect(row?.title).toBe("Changes requested on 'Fish ladder telemetry'");
    expect(row?.message).toBe("Changes requested: Tighten the objectives.");
  });

  it("falls back to the plain message when the comment is blank", () => {
    // Whitespace only is treated as absent, which is why the trim happens
    // before the message is chosen rather than inside the template.
    const row = statusChangeNotification(
      project,
      "changes_requested",
      "u-staff",
      "   "
    );
    expect(row?.title).toBe("Changes requested on 'Fish ladder telemetry'");
    expect(row?.message).toBe("Status changed to changes_requested.");
  });

  it("does not quote a comment on any other status", () => {
    const row = statusChangeNotification(
      project,
      "approved",
      "u-staff",
      "Nice work"
    );
    expect(row?.message).toBe("Status changed to approved.");
  });
});

describe("softDeleteNotification", () => {
  it.each([
    "soft-deleted",
    "restored",
    "hard-deleted",
  ] as const)("names the action in both the title and the message: %s", (action) => {
    const row = softDeleteNotification(project, action, "u-staff");
    expect(row?.userId).toBe("u-proposer");
    expect(row?.type).toBe("soft_delete");
    expect(row?.title).toBe(
      `Your project 'Fish ladder telemetry' was ${action} by staff`
    );
    expect(row?.message).toBe(`Staff performed: ${action}.`);
    expect(row?.link).toBe("/projects/p-1");
  });

  it("says nothing when the proposer is the one who acted", () => {
    expect(
      softDeleteNotification(project, "soft-deleted", "u-proposer")
    ).toBeNull();
  });

  it("says nothing when the project has no proposer", () => {
    expect(
      softDeleteNotification(
        { ...project, proposerId: null },
        "soft-deleted",
        "u-staff"
      )
    ).toBeNull();
  });
});

describe("commentNotifications", () => {
  it("tells the proposer, and links to the comment anchor", () => {
    const rows = commentNotifications(project, comment, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("u-proposer");
    expect(rows[0].type).toBe("comment");
    expect(rows[0].title).toBe("New comment on 'Fish ladder telemetry'");
    expect(rows[0].message).toBe("Looks good.");
    expect(rows[0].link).toBe("/projects/p-1#comment-c-1");
  });

  it("tells nobody about an internal comment", () => {
    // Staff talking among themselves. Checked before recipients are gathered,
    // so a reply to an internal comment does not reach the parent's author
    // either.
    expect(
      commentNotifications(
        project,
        { ...comment, isInternal: true },
        "u-other-staff"
      )
    ).toEqual([]);
  });

  it("does not tell the proposer about their own comment", () => {
    expect(
      commentNotifications(
        project,
        { ...comment, authorId: "u-proposer" },
        null
      )
    ).toEqual([]);
  });

  it("tells the parent's author as well as the proposer", () => {
    const rows = commentNotifications(project, comment, "u-other");
    expect(rows.map((r) => r.userId)).toEqual(["u-proposer", "u-other"]);
  });

  it("does not tell the parent's author about their own reply", () => {
    const rows = commentNotifications(project, comment, "u-staff");
    expect(rows.map((r) => r.userId)).toEqual(["u-proposer"]);
  });

  it("tells the proposer once when they are also the parent's author", () => {
    // The proposer replying under their own comment, answered by someone else.
    // Without the Set this would insert two identical rows.
    const rows = commentNotifications(project, comment, "u-proposer");
    expect(rows.map((r) => r.userId)).toEqual(["u-proposer"]);
  });

  it("truncates the message at 200 characters", () => {
    const rows = commentNotifications(
      project,
      { ...comment, content: "x".repeat(500) },
      null
    );
    expect(rows[0].message).toHaveLength(200);
  });
});
