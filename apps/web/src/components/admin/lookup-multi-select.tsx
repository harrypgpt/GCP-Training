'use client';

import { useEffect, useState, type JSX } from 'react';

import { Badge } from '@/components/ui/badge';
import { inputClass } from '@/components/ui/form-styles';
import { type LookupOption } from './lookup-select';

/** Multi-select for the (potentially several) case studies a question
 * version can link — Stage 6's data model is a real many-to-many. */
export function LookupMultiSelect({
  label,
  values,
  onChange,
  fetchOptions,
}: {
  label: string;
  values: string[];
  onChange: (ids: string[]) => void;
  fetchOptions: (search: string) => Promise<LookupOption[]>;
}): JSX.Element {
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [labelsById, setLabelsById] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      fetchOptions(search)
        .then((opts) => {
          if (cancelled) return;
          setOptions(opts);
          setLabelsById((prev) => {
            const next = { ...prev };
            for (const option of opts) next[option.id] = option.label;
            return next;
          });
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

  function toggle(id: string): void {
    onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <input
        type="search"
        placeholder={`Search ${label.toLowerCase()}…`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={inputClass}
      />
      <div className="max-h-40 overflow-y-auto rounded-md border border-border">
        {options.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No matches.</p>
        ) : (
          options.map((option) => (
            <label
              key={option.id}
              className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={values.includes(option.id)}
                onChange={() => toggle(option.id)}
              />
              {option.label}
            </label>
          ))
        )}
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((id) => (
            <Badge key={id} tone="info" className="gap-1.5">
              {labelsById[id] ?? id}
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={`Remove ${labelsById[id] ?? id}`}
                className="font-bold"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
