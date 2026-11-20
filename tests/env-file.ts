/**
 * @file Reads the checkout's `.env` into the environment, for the test
 * tooling that runs outside Next.js (the Playwright configuration, the
 * integration tests' setup): a checkout sets its test database and its
 * end-to-end port there.
 */

/**
 * Loads `.env` from the working directory. What the environment has
 * already wins, so a variable given on the command line overrides the file.
 * Without a `.env` (in CI) the variables come from the environment alone.
 */
export default function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file (e.g. in CI); the variables come from the environment.
  }
}
