/**
 * Free space on the drive a folder lives on — the "42 GB free" beside the folder in the
 * set-up dialog, so a 9 GB download is never started onto a full disk.
 *
 * The chosen folder may not exist yet, so the nearest existing ancestor is measured. A drive
 * that does not exist at all is null, not a throw: the dialog says "could not read free space"
 * and lets the user pick again.
 */
import { statfs } from "node:fs/promises";
import { dirname } from "node:path";

export async function freeSpaceBytes(path: string): Promise<number | null> {
  let p = path;
  for (let i = 0; i < 64; i++) {
    try {
      const s = await statfs(p);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      const parent = dirname(p);
      if (parent === p) return null;
      p = parent;
    }
  }
  return null;
}
