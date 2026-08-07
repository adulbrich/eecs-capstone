import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  passwordResetEmail,
  projectApprovedEmail,
  projectChangesRequestedEmail,
  projectSubmittedEmail,
  verificationEmail,
} from "../templates";

describe("escapeHtml", () => {
  it("neutralizes every character that can break out of markup", () => {
    expect(escapeHtml(`<img src=x onerror="a" & 'b'>`)).toBe(
      "&lt;img src=x onerror=&quot;a&quot; &amp; &#39;b&#39;&gt;"
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Robot arm for the lab")).toBe("Robot arm for the lab");
  });
});

describe("verificationEmail", () => {
  it("keeps the existing subject and carries the url", () => {
    const email = verificationEmail({ url: "https://x/verify?t=abc" });
    expect(email.subject).toBe("Verify your email");
    expect(email.text).toContain("https://x/verify?t=abc");
    expect(email.html).toContain("https://x/verify?t=abc");
  });
});

describe("passwordResetEmail", () => {
  it("keeps the existing subject and carries the url", () => {
    const email = passwordResetEmail({ url: "https://x/reset?t=abc" });
    expect(email.subject).toBe("Reset your password");
    expect(email.text).toContain("https://x/reset?t=abc");
  });
});

describe("projectSubmittedEmail", () => {
  it("names the project, the proposer, and the review link", () => {
    const email = projectSubmittedEmail({
      description: "A robot arm.",
      proposerEmail: "alex@oregonstate.edu",
      proposerName: "Alex",
      title: "Robot arm",
      url: "https://app/projects/p1",
    });
    expect(email.subject).toBe("New project submitted: Robot arm");
    expect(email.text).toContain("Alex (alex@oregonstate.edu)");
    expect(email.text).toContain("A robot arm.");
    expect(email.text).toContain("https://app/projects/p1");
  });

  it("falls back to the address alone, then to Unknown proposer", () => {
    const noName = projectSubmittedEmail({
      description: null,
      proposerEmail: "alex@oregonstate.edu",
      proposerName: null,
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(noName.text).toContain("alex@oregonstate.edu");

    const neither = projectSubmittedEmail({
      description: null,
      proposerEmail: null,
      proposerName: null,
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(neither.text).toContain("Unknown proposer");
  });

  it("escapes a hostile title in html but not in text", () => {
    const email = projectSubmittedEmail({
      description: null,
      proposerEmail: null,
      proposerName: null,
      title: "<img src=x onerror=alert(1)>",
      url: "https://app/projects/p1",
    });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x");
    expect(email.text).toContain("<img src=x onerror=alert(1)>");
  });

  it("truncates a long description and says where to read the rest", () => {
    const email = projectSubmittedEmail({
      description: "z".repeat(900),
      proposerEmail: null,
      proposerName: null,
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(email.text).toContain("Open the project to read the full proposal.");
    expect(email.text).not.toContain("z".repeat(700));
  });
});

describe("projectApprovedEmail", () => {
  it("says it will be published later and that no further email follows", () => {
    const email = projectApprovedEmail({
      comment: null,
      title: "Robot arm",
      url: "https://app/projects/p1",
    });
    expect(email.subject).toBe("Your project was approved: Robot arm");
    expect(email.text).toContain("published");
    expect(email.text).toContain("will not receive another email");
  });

  it("includes a reviewer comment when there is one", () => {
    const email = projectApprovedEmail({
      comment: "Nice scope.",
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(email.text).toContain("Nice scope.");
  });

  it("omits the reviewer line when the comment is blank", () => {
    const email = projectApprovedEmail({
      comment: "   ",
      title: "T",
      url: "https://app/projects/p1",
    });
    expect(email.text).not.toContain("Note from the reviewer");
  });
});

describe("projectChangesRequestedEmail", () => {
  it("carries the staff note verbatim", () => {
    const email = projectChangesRequestedEmail({
      comment: "Add measurable objectives.",
      title: "Robot arm",
      url: "https://app/projects/p1",
    });
    expect(email.subject).toBe("Changes requested: Robot arm");
    expect(email.text).toContain("Add measurable objectives.");
    expect(email.text).toContain("https://app/projects/p1");
  });
});
