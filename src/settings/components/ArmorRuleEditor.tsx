// Brief #23 Phase C — Destiny-native armor rule editor. Renders inside the
// Armor tab's Panel surface (chrome from Settings.tsx); this file's outer
// container is plain space-y so the editor sits flush within the Panel.

import { useMemo, useState } from 'react';
import { type ArmorRule, summarizeRule } from '@/core/rules/armor-rules';
import type { ArmorTaxonomyPayload } from '@/shared/types';
import { BracketBtn, Btn, Chip, Headline, SectionHead } from '@/components/destiny';

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
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <Headline size="md">{rule.name || 'New armor rule'}</Headline>
        <span className="text-d-9 uppercase tracking-d-wide text-d-text-muted">Armor</span>
      </div>

      <Field label="Name (optional)">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={autoSummary}
          className="w-full px-3 py-2 text-d-12 bg-d-bg-pressed border border-d-hairline text-d-text placeholder:text-d-text-muted focus:outline-none focus:border-d-gold-line transition-colors duration-d-fast"
        />
        <Hint>
          Leave blank to use auto-summary:{' '}
          <span className="font-mono text-d-text-sec">{autoSummary}</span>
        </Hint>
      </Field>

      <Field label="Class">
        <ChipPicker
          options={['any', 'Titan', 'Hunter', 'Warlock'] as AnyClass[]}
          value={cls}
          onChange={setCls}
        />
      </Field>

      <Field label={`Armor sets · ${sets.length} selected`}>
        <input
          placeholder="Filter sets…"
          value={setSearch}
          onChange={(e) => setSetSearch(e.target.value)}
          className="w-full px-3 py-2 text-d-12 bg-d-bg-pressed border border-d-hairline text-d-text placeholder:text-d-text-muted focus:outline-none focus:border-d-gold-line transition-colors duration-d-fast mb-2"
        />
        {taxonomy ? (
          <CheckList
            options={filteredSets}
            selected={sets}
            onChange={setSets}
            emptyMessage={setSearch ? 'No sets match the search.' : 'Manifest loading…'}
          />
        ) : (
          <Hint italic>Loading sets from manifest…</Hint>
        )}
        <Hint>Empty = any set.</Hint>
      </Field>

      <Field label={`Archetypes · ${archetypes.length} selected`}>
        {taxonomy ? (
          <CheckList
            options={taxonomy.archetypes}
            selected={archetypes}
            onChange={setArchetypes}
            emptyMessage="No archetypes found in manifest."
          />
        ) : (
          <Hint italic>Loading archetypes…</Hint>
        )}
        <Hint>Empty = any archetype.</Hint>
      </Field>

      <Field label={`Tertiary stats · ${tertiaries.length} selected`}>
        <CheckList
          options={taxonomy?.tertiaries ?? ['Weapons', 'Health', 'Grenade', 'Super', 'Class', 'Melee']}
          selected={tertiaries}
          onChange={setTertiaries}
          emptyMessage=""
        />
        <Hint>Empty = any tertiary.</Hint>
      </Field>

      <Field label="Minimum tier">
        <ChipPicker
          options={[5, 4] as (4 | 5)[]}
          value={minTier}
          labelFor={(v) => `Tier ${v}+`}
          onChange={setMinTier}
        />
      </Field>

      {matchesEverything && (
        <div className="border border-d-gold-line bg-d-gold-dim text-d-gold text-d-11 px-3 py-2 uppercase tracking-d-wide">
          ⚠ This rule will match every Tier {minTier}+ armor drop.
        </div>
      )}

      <div className="flex gap-2 pt-3 border-t border-d-hairline">
        <BracketBtn small onClick={handleSave}>
          Save Rule
        </BracketBtn>
        <Btn variant="ghost" small onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <SectionHead>{label}</SectionHead>
      {children}
    </div>
  );
}

function Hint({
  children,
  italic = false,
}: {
  children: React.ReactNode;
  italic?: boolean;
}) {
  return (
    <div className={`text-d-10 text-d-text-muted mt-1 ${italic ? 'italic' : ''}`}>
      {children}
    </div>
  );
}

function ChipPicker<T extends string | number>(props: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labelFor?: (v: T) => string;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {props.options.map((opt) => {
        const label = props.labelFor ? props.labelFor(opt) : String(opt);
        return (
          <Chip
            key={String(opt)}
            active={props.value === opt}
            color="gold"
            onClick={() => props.onChange(opt)}
          >
            {label}
          </Chip>
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
    return <div className="text-d-10 text-d-text-muted italic py-2">{emptyMessage}</div>;
  }
  const toggle = (value: string) => {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else onChange([...selected, value]);
  };
  return (
    <div className="max-h-48 overflow-auto d-scroll flex flex-wrap gap-1 border border-d-hairline bg-d-bg-pressed p-2">
      {options.map((opt) => (
        <Chip
          key={opt}
          active={selected.includes(opt)}
          color="gold"
          onClick={() => toggle(opt)}
        >
          {opt}
        </Chip>
      ))}
    </div>
  );
}
