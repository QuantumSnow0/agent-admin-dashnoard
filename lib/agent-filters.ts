export const AGENT_FILTER_KEYS = [
  "status",
  "town",
  "area",
  "connect",
  "joined",
  "rating",
  "location",
  "scope",
  "fallback",
  "earnings",
  "balance",
] as const;

export type AgentFilterKey = (typeof AGENT_FILTER_KEYS)[number];

export type AgentFilterOption = {
  value: string;
  label: string;
};

export type AgentFilterDefinition = {
  key: AgentFilterKey;
  label: string;
  multiple: boolean;
  options?: AgentFilterOption[];
};

export const AGENT_FILTERS: AgentFilterDefinition[] = [
  {
    key: "status",
    label: "Status",
    multiple: true,
    options: [
      { value: "approved", label: "Approved" },
      { value: "pending", label: "Pending" },
      { value: "rejected", label: "Rejected" },
      { value: "banned", label: "Banned" },
    ],
  },
  { key: "town", label: "Town", multiple: true },
  { key: "area", label: "Area", multiple: true },
  {
    key: "connect",
    label: "Airtel Connect",
    multiple: false,
    options: [
      { value: "opened", label: "Connect opened" },
      { value: "not_opened", label: "Connect not opened" },
    ],
  },
  {
    key: "joined",
    label: "Joined",
    multiple: false,
    options: [
      { value: "today", label: "Today" },
      { value: "7d", label: "Last 7 days" },
      { value: "30d", label: "Last 30 days" },
      { value: "90d", label: "Last 90 days" },
      { value: "year", label: "This year" },
    ],
  },
  {
    key: "rating",
    label: "App rating",
    multiple: false,
    options: [
      { value: "5", label: "5 stars" },
      { value: "4", label: "4 stars" },
      { value: "3", label: "3 stars" },
      { value: "2", label: "2 stars" },
      { value: "1", label: "1 star" },
      { value: "unrated", label: "Not rated" },
    ],
  },
  {
    key: "location",
    label: "Working location",
    multiple: false,
    options: [
      { value: "set", label: "Location set" },
      { value: "missing", label: "Location missing" },
    ],
  },
  {
    key: "scope",
    label: "Dispatch scope",
    multiple: true,
    options: [
      { value: "both", label: "Airtel & Safaricom" },
      { value: "airtel", label: "Airtel only" },
      { value: "safaricom", label: "Safaricom only" },
      { value: "none", label: "No leads" },
    ],
  },
  {
    key: "fallback",
    label: "Fallback agent",
    multiple: false,
    options: [
      { value: "yes", label: "Fallback enabled" },
      { value: "no", label: "Not a fallback agent" },
    ],
  },
  {
    key: "earnings",
    label: "Total earnings",
    multiple: false,
    options: [
      { value: "zero", label: "KSh 0" },
      { value: "under_1k", label: "Below KSh 1,000" },
      { value: "1k_5k", label: "KSh 1,000–4,999" },
      { value: "5k_plus", label: "KSh 5,000+" },
    ],
  },
  {
    key: "balance",
    label: "Available balance",
    multiple: false,
    options: [
      { value: "zero", label: "KSh 0" },
      { value: "under_1k", label: "Below KSh 1,000" },
      { value: "1k_5k", label: "KSh 1,000–4,999" },
      { value: "5k_plus", label: "KSh 5,000+" },
    ],
  },
];

export function isAgentFilterKey(value: string): value is AgentFilterKey {
  return AGENT_FILTER_KEYS.includes(value as AgentFilterKey);
}
