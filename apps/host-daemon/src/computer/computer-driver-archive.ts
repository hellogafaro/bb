import { spawn as nodeSpawn } from "node:child_process";

export type ArchiveSpawnFn = typeof nodeSpawn;

/**
 * cua-driver releases ship as a plain tar.gz on Linux/macOS and a zip on
 * Windows. The OS-native `tar` handles both: GNU/BSD tar auto-detect gzip
 * compression from the file's magic bytes, and Windows ships bsdtar (which
 * auto-detects zip) as its `tar.exe` since Windows 10 1803.
 */
export function extractArchive(
  archivePath: string,
  destDir: string,
  spawnImpl: ArchiveSpawnFn = nodeSpawn,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("tar", ["-xf", archivePath, "-C", destDir], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(0, 2_000);
    });
    child.on("error", (error) => {
      reject(new Error(`tar is unavailable to extract the cua-driver archive: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`tar exited with code ${code} extracting the cua-driver archive: ${stderr.trim()}`));
    });
  });
}
