export type ConnectStateName =
  | "disconnected"
  | "pairing"
  | "connected"
  | "reconnecting";

export interface ShareListing {
  hostId: string;
  hostName: string;
  port: number;
  createdAt: number;
  url: string;
  unavailableReason?: string;
}

export interface ConnectStatus {
  state: ConnectStateName;
  paired: boolean;
  handle: string | null;
  url: string | null;
  dashboardUrl: string;
  lastError: string | null;
  nextRetryAt: number | null;
  since: number;
  remoteClients: number;
  lastRemoteActivityAt: number | null;
  shares: ShareListing[];
}

export const CONNECT_REALTIME_CHANNEL = "connect";

