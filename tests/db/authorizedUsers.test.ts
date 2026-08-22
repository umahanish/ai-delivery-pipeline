import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  getUserRole,
  listAuthorizedUsers,
  removeAuthorizedUser,
  upsertAuthorizedUser,
} from "../../src/db/authorizedUsers";
import { getTestPool, resetDb } from "../helpers/db";

const pool = getTestPool();

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("upsertAuthorizedUser / getUserRole", () => {
  it("returns null for a login that was never added -- no open self-signup", async () => {
    expect(await getUserRole(pool, "someone-random")).toBeNull();
  });

  it("returns the role once added", async () => {
    await upsertAuthorizedUser(pool, "alice", "maintainer", "cli");
    expect(await getUserRole(pool, "alice")).toBe("maintainer");
  });

  it("is case-insensitive on the GitHub login, matching GitHub's own behavior", async () => {
    await upsertAuthorizedUser(pool, "Alice", "viewer", "cli");
    expect(await getUserRole(pool, "alice")).toBe("viewer");
    expect(await getUserRole(pool, "ALICE")).toBe("viewer");
  });

  it("upsert changes the role rather than erroring on a duplicate login", async () => {
    await upsertAuthorizedUser(pool, "bob", "viewer", "cli");
    await upsertAuthorizedUser(pool, "bob", "maintainer", "cli");
    expect(await getUserRole(pool, "bob")).toBe("maintainer");
  });
});

describe("listAuthorizedUsers", () => {
  it("returns every authorized user, oldest first", async () => {
    await upsertAuthorizedUser(pool, "first", "maintainer", "cli");
    await upsertAuthorizedUser(pool, "second", "viewer", "cli");

    const users = await listAuthorizedUsers(pool);
    expect(users.map((u) => u.githubLogin)).toEqual(["first", "second"]);
  });
});

describe("removeAuthorizedUser", () => {
  it("returns true and revokes access when the user existed", async () => {
    await upsertAuthorizedUser(pool, "carol", "viewer", "cli");
    expect(await removeAuthorizedUser(pool, "carol")).toBe(true);
    expect(await getUserRole(pool, "carol")).toBeNull();
  });

  it("returns false for a login that was never authorized", async () => {
    expect(await removeAuthorizedUser(pool, "never-existed")).toBe(false);
  });
});
