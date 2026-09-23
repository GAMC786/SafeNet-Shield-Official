import { describe, expect, test } from "vitest";

import { Capabilities, hasCapability, Roles, getRoleFromCapabilities } from "~/server/web/roles";

describe("Roles and Capabilities", () => {
  describe("Roles definitions", () => {
    test("owner has all capabilities including ui_access", () => {
      expect(Roles.owner & Capabilities.ui_access).toBe(Capabilities.ui_access);
      expect(Roles.owner & Capabilities.owner).toBe(Capabilities.owner);
      expect(Roles.owner & Capabilities.write_users).toBe(Capabilities.write_users);
    });

    test("admin has ui_access but not owner flag", () => {
      expect(Roles.admin & Capabilities.ui_access).toBe(Capabilities.ui_access);
      expect(Roles.admin & Capabilities.owner).toBe(0);
      expect(Roles.admin & Capabilities.write_users).toBe(Capabilities.write_users);
    });

    test("auditor has ui_access but limited write permissions", () => {
      expect(Roles.auditor & Capabilities.ui_access).toBe(Capabilities.ui_access);
      expect(Roles.auditor & Capabilities.write_users).toBe(0);
      expect(Roles.auditor & Capabilities.read_users).toBe(Capabilities.read_users);
    });

    test("member has NO capabilities (including no ui_access)", () => {
      expect(Roles.member).toBe(0);
      expect(Roles.member & Capabilities.ui_access).toBe(0);
      expect(Roles.member & Capabilities.read_machines).toBe(0);
    });
  });

  describe("hasCapability function", () => {
    test("returns true when role has the capability", () => {
      expect(hasCapability("owner", "ui_access")).toBe(true);
      expect(hasCapability("admin", "ui_access")).toBe(true);
      expect(hasCapability("auditor", "ui_access")).toBe(true);
    });

    test("returns false when role lacks the capability", () => {
      expect(hasCapability("member", "ui_access")).toBe(false);
      expect(hasCapability("auditor", "write_users")).toBe(false);
    });

    test("only owner has owner capability", () => {
      expect(hasCapability("owner", "owner")).toBe(true);
      expect(hasCapability("admin", "owner")).toBe(false);
      expect(hasCapability("member", "owner")).toBe(false);
    });
  });

  describe("getRoleFromCapabilities function", () => {
    test("returns correct role for exact capability match", () => {
      expect(getRoleFromCapabilities(Roles.owner)).toBe("owner");
      expect(getRoleFromCapabilities(Roles.admin)).toBe("admin");
      expect(getRoleFromCapabilities(Roles.auditor)).toBe("auditor");
      expect(getRoleFromCapabilities(Roles.member)).toBe("member");
    });

    test("returns member for unrecognized capability values", () => {
      expect(getRoleFromCapabilities(999999 as any)).toBe("member");
    });
  });

  describe("member role", () => {
    test("blocks UI access", () => {
      const memberCaps = Roles.member;
      const hasUIAccess = (memberCaps & Capabilities.ui_access) === Capabilities.ui_access;

      expect(hasUIAccess).toBe(false);
      expect(memberCaps).toBe(0);
    });

    test("other roles have UI access", () => {
      const rolesWithUIAccess = ["owner", "admin", "network_admin", "it_admin", "auditor"] as const;

      for (const role of rolesWithUIAccess) {
        expect(hasCapability(role, "ui_access")).toBe(true);
      }
    });
  });
});
