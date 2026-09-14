'use client';

import { useEffect, useId, useState, type JSX } from 'react';

import { inputClass } from '@/components/ui/form-styles';

export interface LookupOption {
  id: string;
  label: string;
}

/**
 * A searchable single-select backed by a server lookup — used for every
 * level/domain/role/objective/source/observation/case-study picker in the
 * question form and filter bar. Options are re-fetched (debounced) as the
 * admin types, so this never tries to hold "the whole vocabulary" in the
 * browser at once.
 */
export function LookupSelect({
  label,
  value,
  onChange,
  fetchOptions,
  emptyLabel = 'None',
  hideLabel = false,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  fetchOptions: (search: string) => Promise<LookupOption[]>;
  emptyLabel?: string;
  hideLabel?: boolean;
}): JSX.Element {
  const id = useId();
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      fetchOptions(search)
        .then((opts) => {
          if (!cancelled) setOptions(opts);
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchOptions is a stable inline reference per field
  }, [search]);

  return (
    <div className="space-y-1.5">
      {!hideLabel && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <select
        id={id}
        aria-label={hideLabel ? label : undefined}
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        type="search"
        placeholder={`Filter ${label.toLowerCase()}…`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={`${inputClass} h-8 text-xs`}
      />
    </div>
  );
}
