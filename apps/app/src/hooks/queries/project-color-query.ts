import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { apiClient } from "@/lib/api-server";
import { request, requestOptions } from "@/lib/api";
import { sidebarNavigationQueryKey } from "./query-keys";
import { REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY } from "./query-policies";

function selectProjectColor(
  navigation: SidebarBootstrapResponse,
  projectId: string,
): number | null {
  if (projectId === PERSONAL_PROJECT_ID) {
    return navigation.personalProject.color;
  }
  return (
    navigation.projects.find((project) => project.id === projectId)?.color ??
    null
  );
}

export function useProjectColor(projectId: string | null): number | null {
  const select = useCallback(
    (navigation: SidebarBootstrapResponse) =>
      projectId === null ? null : selectProjectColor(navigation, projectId),
    [projectId],
  );
  const { data } = useQuery<SidebarBootstrapResponse, Error, number | null>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) =>
      request<SidebarBootstrapResponse>(
        apiClient["sidebar-bootstrap"].$get(undefined, requestOptions(signal)),
      ),
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
    enabled: false,
    select,
  });
  return data ?? null;
}
