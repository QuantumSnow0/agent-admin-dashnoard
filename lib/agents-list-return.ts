export const AGENTS_LIST_RETURN_KEY = "wam:agents-list-return";

export function agentsListHref(search: string): string {
  const query = search.replace(/^\?/, "");
  return query ? `/dashboard/agents?${query}` : "/dashboard/agents";
}

export function saveAgentsListReturn(search: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AGENTS_LIST_RETURN_KEY, search.replace(/^\?/, ""));
}

export function readAgentsListHref(): string {
  if (typeof window === "undefined") return "/dashboard/agents";
  return agentsListHref(sessionStorage.getItem(AGENTS_LIST_RETURN_KEY) ?? "");
}
