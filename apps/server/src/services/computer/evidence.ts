import { posix } from "node:path";
import type { WorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { requireThreadStoragePath } from "../threads/thread-storage.js";
import {
  callHostOnlineRpcForWork,
  callHostRetryableOnlineRpc,
} from "../hosts/online-rpc.js";

export interface EvidenceLocation {
  readonly hostId: string;
  readonly storageRootPath: string;
}

export async function threadStorageLocation(
  deps: WorkSessionDeps,
  threadId: string,
  hostId: string,
): Promise<EvidenceLocation> {
  return {
    hostId,
    storageRootPath: await requireThreadStoragePath(deps, { hostId, threadId }),
  };
}

export async function writeEvidence(
  deps: WorkSessionDeps,
  threadId: string,
  storageHostId: string,
  runId: string,
  name: string,
  contentBase64: string,
): Promise<string> {
  const location = await threadStorageLocation(deps, threadId, storageHostId);
  const relativePath = `computer/${runId}/${name}`;
  await callHostOnlineRpcForWork(deps, {
    hostId: location.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.write_file",
      path: posix.join(location.storageRootPath, relativePath),
      rootPath: location.storageRootPath,
      content: contentBase64,
      contentEncoding: "base64",
      createParents: true,
    },
  });
  return relativePath;
}

export async function copyIntoEvidence(
  deps: WorkSessionDeps,
  threadId: string,
  storageHostId: string,
  runId: string,
  name: string,
  sourceHostId: string,
  sourcePath: string,
): Promise<string> {
  const source = await callHostRetryableOnlineRpc(deps, {
    hostId: sourceHostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "host.read_file", path: sourcePath },
  });
  if ("notModified" in source) {
    throw new Error(`Unexpected not-modified response reading ${sourcePath}`);
  }
  const location = await threadStorageLocation(deps, threadId, storageHostId);
  const relativePath = `computer/${runId}/${name}`;
  await callHostOnlineRpcForWork(deps, {
    hostId: location.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.write_file",
      path: posix.join(location.storageRootPath, relativePath),
      rootPath: location.storageRootPath,
      content: source.content,
      contentEncoding: source.contentEncoding,
      createParents: true,
    },
  });
  return relativePath;
}
