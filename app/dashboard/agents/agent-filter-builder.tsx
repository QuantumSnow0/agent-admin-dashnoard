"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, SlidersHorizontal, X } from "lucide-react";

import {
  AGENT_FILTERS,
  type AgentFilterKey,
  type AgentFilterOption,
} from "@/lib/agent-filters";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AgentFilterBuilderProps = {
  towns: string[];
  areas: string[];
};

export function AgentFilterBuilder({
  towns,
  areas,
}: AgentFilterBuilderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filterKey, setFilterKey] = useState<AgentFilterKey | "">("");
  const [filterValue, setFilterValue] = useState("");

  const dynamicOptions = useMemo<Record<"town" | "area", AgentFilterOption[]>>(
    () => ({
      town: towns.map((town) => ({ value: town, label: town })),
      area: areas.map((area) => ({ value: area, label: area })),
    }),
    [areas, towns]
  );

  const selectedDefinition = AGENT_FILTERS.find(
    (definition) => definition.key === filterKey
  );
  const selectedOptions =
    filterKey === "town" || filterKey === "area"
      ? dynamicOptions[filterKey]
      : selectedDefinition?.options ?? [];

  const chips = AGENT_FILTERS.flatMap((definition) =>
    searchParams.getAll(definition.key).map((value) => {
      const options =
        definition.key === "town" || definition.key === "area"
          ? dynamicOptions[definition.key]
          : definition.options ?? [];
      return {
        key: definition.key,
        category: definition.label,
        value,
        label: options.find((option) => option.value === value)?.label ?? value,
      };
    })
  );

  const navigate = (params: URLSearchParams) => {
    params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  const addFilter = () => {
    if (!filterKey || !filterValue || !selectedDefinition) return;

    const params = new URLSearchParams(searchParams.toString());
    const existing = params.getAll(filterKey);

    if (!selectedDefinition.multiple) {
      params.delete(filterKey);
    }
    if (!existing.includes(filterValue) || !selectedDefinition.multiple) {
      params.append(filterKey, filterValue);
    }

    navigate(params);
    setFilterValue("");
  };

  const removeFilter = (key: AgentFilterKey, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const remaining = params.getAll(key).filter((item) => item !== value);
    params.delete(key);
    remaining.forEach((item) => params.append(key, item));
    navigate(params);
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    AGENT_FILTERS.forEach(({ key }) => params.delete(key));
    params.delete("from");
    params.delete("to");
    navigate(params);
  };

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          Add filter
        </div>
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(150px,0.8fr)_minmax(190px,1fr)_auto]">
          <Select
            value={filterKey}
            onValueChange={(value) => {
              setFilterKey(value as AgentFilterKey);
              setFilterValue("");
            }}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              {AGENT_FILTERS.map((definition) => (
                <SelectItem key={definition.key} value={definition.key}>
                  {definition.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filterValue}
            onValueChange={setFilterValue}
            disabled={!filterKey || selectedOptions.length === 0}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue
                placeholder={filterKey ? "Sub-filter" : "Choose a filter first"}
              />
            </SelectTrigger>
            <SelectContent>
              {selectedOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            onClick={addFilter}
            disabled={!filterKey || !filterValue}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span
              key={`${chip.key}:${chip.value}`}
              className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs"
            >
              <span className="text-muted-foreground">{chip.category}:</span>
              <span className="font-medium">{chip.label}</span>
              <button
                type="button"
                className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => removeFilter(chip.key, chip.value)}
                aria-label={`Remove ${chip.category}: ${chip.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
