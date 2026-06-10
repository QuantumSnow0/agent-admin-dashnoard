"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Keeps a search input in sync with a URL search param without racing:
 * stale navigations won't overwrite text while the field is focused.
 */
export function useDebouncedSearchParam(
  searchQuery: string,
  onQueryCommit: (query: string) => void,
  debounceMs = DEFAULT_DEBOUNCE_MS
) {
  const [searchInput, setSearchInput] = useState(searchQuery);
  const isFocusedRef = useRef(false);
  const lastCommittedRef = useRef(searchQuery);

  useEffect(() => {
    if (!isFocusedRef.current || searchQuery === lastCommittedRef.current) {
      setSearchInput(searchQuery);
      lastCommittedRef.current = searchQuery;
    }
  }, [searchQuery]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const timer = window.setTimeout(() => {
      if (trimmed !== searchQuery) {
        lastCommittedRef.current = trimmed;
        onQueryCommit(trimmed);
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [searchInput, searchQuery, onQueryCommit, debounceMs]);

  const handleFocus = useCallback(() => {
    isFocusedRef.current = true;
  }, []);

  const handleBlur = useCallback(() => {
    isFocusedRef.current = false;
  }, []);

  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(event.target.value);
  }, []);

  const resetSearchInput = useCallback((value = "") => {
    lastCommittedRef.current = value;
    setSearchInput(value);
  }, []);

  return {
    searchInput,
    setSearchInput,
    resetSearchInput,
    searchField: {
      value: searchInput,
      onChange: handleChange,
      onFocus: handleFocus,
      onBlur: handleBlur,
    },
  };
}
