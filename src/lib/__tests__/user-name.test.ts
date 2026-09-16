import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { requireUserName } from "#/lib/_internal/user-name";

describe("requireUserName", () => {
  it("returns the name without its padding", () => {
    expect(requireUserName("  Ada  ")).toBe("Ada");
  });

  it("refuses a name that is only whitespace", () => {
    expect(() => requireUserName("   ")).toThrow(APIError);
  });

  it("refuses an empty name with a 400", () => {
    try {
      requireUserName("");
      expect.unreachable("an empty name should be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      expect((error as APIError).status).toBe("BAD_REQUEST");
    }
  });

  it("refuses a name that is not a string at all", () => {
    // Better Auth types `name` as a string, so this is the admin plugin's
    // open data record and any other caller that hands over whatever it has.
    expect(() => requireUserName(undefined)).toThrow(APIError);
    expect(() => requireUserName(null)).toThrow(APIError);
  });
});
