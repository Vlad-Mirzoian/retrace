import { createInterface } from "node:readline/promises";

/**
 * A yes/no prompt on stdin/stdout, for destructive commands (`delete`,
 * `reset`) to gate on before touching anything. Anything but an explicit
 * y/yes reply counts as "no" — an empty line, Ctrl+D (EOF, e.g.
 * non-interactive stdin in a script or CI), or a typo must never
 * accidentally confirm something irreversible.
 */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
