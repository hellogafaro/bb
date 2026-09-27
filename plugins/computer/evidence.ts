import type { BbPluginApi } from "@get-bb/plugin-sdk";

export interface EvidenceLocation {
  readonly hostId: string;
  readonly storageRootPath: string;
}

export async function threadStorageLocation(bb: BbPluginApi, threadId: string): Promise<EvidenceLocation> {
  const location = await bb.sdk.threads.storageLocation({ threadId });
  return { hostId: location.hostId, storageRootPath: location.storageRootPath };
}

export async function writeEvidence(
  bb: BbPluginApi,
  threadId: string,
  runId: string,
  name: string,
  contentBase64: string,
): Promise<string> {
  const location = await threadStorageLocation(bb, threadId);
  const relativePath = `computer/${runId}/${name}`;
  await bb.sdk.files.write({
    hostId: location.hostId,
    path: relativePath,
    rootPath: location.storageRootPath,
    content: contentBase64,
    contentEncoding: "base64",
    createParents: true,
  });
  return relativePath;
}

export async function copyIntoEvidence(
  bb: BbPluginApi,
  threadId: string,
  runId: string,
  name: string,
  sourceHostId: string,
  sourcePath: string,
): Promise<string> {
  const source = await bb.sdk.files.read({ hostId: sourceHostId, path: sourcePath });
  const location = await threadStorageLocation(bb, threadId);
  const relativePath = `computer/${runId}/${name}`;
  await bb.sdk.files.write({
    hostId: location.hostId,
    path: relativePath,
    rootPath: location.storageRootPath,
    content: source.content,
    contentEncoding: source.contentEncoding === "base64" ? "base64" : "utf8",
    createParents: true,
  });
  return relativePath;
}
