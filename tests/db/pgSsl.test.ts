import { describe, expect, it } from "vitest";
import { sslConfigFor } from "../../src/db/pgSsl";

describe("sslConfigFor", () => {
  it("returns false for localhost", () => {
    expect(sslConfigFor("postgres://user:pass@localhost:5432/db")).toBe(false);
  });

  it("returns false for 127.0.0.1", () => {
    expect(sslConfigFor("postgres://user:pass@127.0.0.1:5432/db")).toBe(false);
  });

  it("returns rejectUnauthorized: false for a remote hosted Postgres", () => {
    expect(sslConfigFor("postgres://user:pass@dpg-example.oregon-postgres.render.com:5432/db")).toEqual({
      rejectUnauthorized: false,
    });
  });
});
