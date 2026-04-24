import { useMemo, useState } from 'react';
import { type ArmorRule, summarizeRule } from '@/core/rules/armor-rules';
import type { ArmorTaxonomyPayload } from '@/shared/types';

type AnyClass = 'any' | 'Titan' | 'Hunter' | 'Warlock';

interface ArmorRuleEditorProps {
  rule: ArmorRule;
  taxonomy: ArmorTaxonomyPayload | null;
  onSave: (rule: ArmorRule) => void;
  onCancel: () => void;
}

export function ArmorRuleEditor({ rule, taxonomy, onSave, onCancel }: ArmorRuleEditorProps) {
  const [name, setName] = useState(rule.name);
  const [cls, setCls] = useState<AnyClass>(rule.class);
  const [sets, setSets] = useState<string[]>(rule.sets);
  const [archetypes, setArchetypes] = useState<string[]>(rule.archetypes);
  const [tertiaries, setTertiaries] = useState<string[]>(rule.tertiaries);
  const [minTier, setMinTier] = useState<4 | 5>(rule.minTier);
  const [setSearch, setSetSearch] = useState('');

  const filteredSets = useMemo(() => {
    const all = taxonomy?.sets ?? [];
    if (!setSearch) return all;
    const needle = setSearch.toLowerCase();
    return all.filter((s) => s.toLowerCase().includes(needle));
  }, [taxonomy, setSearch]);

  const matchesEverything =
    cls === 'any' && sets.length === 0 && archetypes.length === 0 && tertiaries.length === 0;

  const autoSummary = summarizeRule({
    id: rule.id,
    name: '',
    enabled: true,
    class: cls,
    sets,
    archetypes,
    tertiaries,
    minTier,
  });

  const handleSave = () => {
    onSave({
      ...rule,
      name: name.trim(),
      class: cls,
      sets,
      archetypes,
      tertiaries,
      minTier,
    });
  };

  return (
    <div className="rounded-lg border border-bg-border bg-bg-card p-5 space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-text-primary">
          {rule.name || 'New armor rule'}
        </h2>
        <span className="text-xs text-text-muted">Armor</span>
      </div>

      <Section label="Name (optional)">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={autoSummary}
          className="w-full px-3 py-1.5 text-sm rounded bg-bg-primary border border-bg-border text-text-primary"
        />
        <p className="text-xs text-text-muted mt-1">
          Leave blank to use auto-summary:{' '}
          <span className="font-mono">{autoSummary}</span>
        </p>
      </Section>

      <Section label="Class">
        <RadioRow
          options={['any', 'Titan', 'Hunter', 'Warlock'] as AnyClass[]}
          value={cls}
          onChange={setCls}
        />
      </Section>

      <Section label={`Armor sets (${sets.length} selected)`}>
        <input
          placeholder="Filter sets…"
          value={setSearch}
          onChange={(e) => setSetSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded bg-bg-primary border border-bg-border text-text-primary mb-2"
        />
        {taxonomy ? (
          <CheckList
            options={filteredSets}
            selected={sets}
            onChange={setSets}
            emptyMessage={setSearch ? 'No sets match the search.' : 'Manifest loading…'}
          />
        ) : (
          <div className="text-xs text-text-muted italic">Loading sets from manifest…</div>
        )}
        <p className="text-xs text-text-muted mt-1">Empty = any set.</p>
      </Section>

      <Section label={`Archetypes (${archetypes.length} selected)`}>
        {taxonomy ? (
          <CheckList
            options={taxonomy.archetypes}
            selected={archetypes}
            onChange={setArchetypes}
            emptyMessage="No archetypes found in manifest."
          />
        ) : (
          <div className="text-xs text-text-muted italic">Loading archetypes…</div>
        )}
        <p className="text-xs text-text-muted mt-1">Empty = any archetype.</p>
      </Section>

      <Section label={`Tertiary stats (${tertiaries.length} selected)`}>
        <CheckList
          options={taxonomy?.tertiaries ?? ['Weapons', 'Health', 'Grenade', 'Super', 'Class', 'Melee']}
          selected={tertiaries}
          onChange={setTertiaries}
          emptyMessage=""
        />
        <p className="text-xs text-text-muted mt-1">Empty = any tertiary.</p>
      </Section>

      <Section label="Minimum tier">
        <RadioRow
          options={[5, 4] as (4 | 5)[]}
          value={minTier}
          labelFor={(v) => `Tier ${v}+`}
          onChange={setMinTier}
        />
      </Section>

      {matchesEverything && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-xs px-3 py-2">
          This rule will match every Tier {minTier}+ armor drop.
        </div>
      )}

      <div className="flex gap-2 pt-1 border-t border-bg-border">
        <button
          onClick={handleSave}
          className="px-4 py-1.5 text-sm rounded bg-rahool-blue/20 text-rahool-blue border border-rahool-blue/40 hover:bg-rahool-blue/30"
        >
          Save rule
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm rounded border border-bg-border text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm text-text-primary mb-2">{label}</div>
      {children}
    </div>
  );
}

function RadioRow<T extends string | number>(props: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labelFor?: (v: T) => string;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {props.options.map((opt) => {
        const active = props.value === opt;
        const label = props.labelFor ? props.labelFor(opt) : String(opt);
        return (
          <button
            key={String(opt)}
            onClick={() => props.onChange(opt)}
            className={`px-3 py-1 text-sm rounded border ${
              active
                ? 'bg-rahool-blue/20 text-rahool-blue border-rahool-blue/40'
                : 'bg-bg-primary text-text-muted border-bg-border hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function CheckList(props: {
  options: readonly string[];
  selected: string[];
  onChange: (v: string[]) => void;
  emptyMessage: string;
}) {
  const { options, selected, onChange, emptyMessage } = props;
  if (options.length === 0) {
    return <div className="text-xs text-text-muted italic py-2">{emptyMessage}</div>;
  }
  const toggle = (value: string) => {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else onChange([...selected, value]);
  };
  return (
    <div className="max-h-48 overflow-auto flex flex-wrap gap-1 rounded border border-bg-border bg-bg-primary p-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            className={`px-2 py-1 text-xs rounded border ${
              active
                ? 'bg-rahool-blue/20 text-rahool-blue border-rahool-blue/40'
                : 'bg-bg-card text-text-muted border-bg-border hover:text-text-primary'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
