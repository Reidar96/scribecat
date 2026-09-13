import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Password hashing is deliberately slow (scrypt, ~64 MiB); a test that
    // logs in a few times needs more than the 5 second default.
    testTimeout: 30_000,
    include: ["test/**/*.test.ts"]
  }
});
