import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/crypto.js";

describe("token encryption", () => {
  it("round-trips an OAuth token without storing plaintext", async () => {
    const key = btoa(Array.from({ length: 32 }, () => String.fromCharCode(7)).join(""));
    const encrypted = await encryptSecret("secret-access-token", key);
    expect(encrypted).not.toContain("secret-access-token");
    await expect(decryptSecret(encrypted, key)).resolves.toBe("secret-access-token");
  });

  it("rejects keys that are not 32 bytes", async () => {
    const key = btoa(Array.from({ length: 16 }, () => String.fromCharCode(7)).join(""));
    await expect(encryptSecret("token", key)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });
});
