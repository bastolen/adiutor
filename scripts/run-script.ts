/**
 * @file How the scripts in `scripts/` that use the database run: log
 * redaction first, then the script's `main`, then the database's pool closed
 * and the process ended with the exit code `main` gave, also when it threw.
 */
import { db } from '../src/db';
import { installLogRedaction } from '../src/lib/log-redaction';

/**
 * Runs a script's `main` and closes the database's pool afterwards, whether
 * it returned or threw. An error it threw is logged, and counts as exit code 1.
 *
 * @param main - The script.
 * @returns The exit code.
 */
async function runAndClose(main: () => Promise<number>): Promise<number> {
  try {
    return await main();
  } catch (error) {
    console.error(error);
    return 1;
  } finally {
    await db.$client.end();
  }
}

/**
 * Runs a script: installs the log redaction before anything else, so
 * database errors are logged without the values they were sent, then runs
 * `main`, closes the database's pool and exits with `main`'s code (1 when it
 * threw, or when closing the pool failed). Every script that uses the
 * database ends with it.
 *
 * @param main - The script: does its work and returns the process exit code.
 */
export default function runScript(main: () => Promise<number>): void {
  installLogRedaction();
  runAndClose(main).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
}
