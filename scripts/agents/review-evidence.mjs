import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Keep the original artifacts until every evidence copy has succeeded.
export function preserveReviewEvidence(temporary, createDirectory, io = {}) {
  const exists = io.exists || existsSync;
  const copy = io.copy || copyFileSync;
  const remove = io.remove || (path => rmSync(path, { recursive: true, force: true }));
  if (!temporary) return 'none';
  const files = [['out.md', 'result.md'], ['run.log', 'run.log'], ['diff.patch', 'diff.patch'], ['refs.txt', 'refs.txt']]
    .filter(([source]) => exists(join(temporary, source)));
  try {
    const evidence = files.length ? createDirectory() : 'none';
    for (const [source, target] of files) copy(join(temporary, source), join(evidence, target));
    remove(temporary);
    return evidence;
  } catch (error) {
    error.recoveryPath = temporary;
    throw error;
  }
}
