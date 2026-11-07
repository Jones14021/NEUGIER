import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Italic, Link as LinkIcon, List, ListOrdered } from 'lucide-react';

/**
 * Markdown-light: **fett**, *kursiv*, "- " Liste, "1. " Nummerierung, "# " Überschrift, URLs/[Text](URL).
 * Gespeichert wird reiner Text; Darstellung ohne innerHTML (kein XSS).
 */
export function RichTextView({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    blocks.push(list.ordered ? <ol key={blocks.length}>{list.items}</ol> : <ul key={blocks.length}>{list.items}</ul>);
    list = null;
  };
  text.split('\n').forEach((line, i) => {
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const h = /^#{1,3}\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push(<li key={i}>{inline((ul ?? ol)![1])}</li>);
      return;
    }
    flush();
    if (h) blocks.push(<strong key={i} className="rt-h">{inline(h[1])}</strong>);
    else if (line.trim() === '') blocks.push(<div key={i} className="rt-gap" />);
    else blocks.push(<div key={i}>{inline(line)}</div>);
  });
  flush();
  return <div className={`rt ${className ?? ''}`}>{blocks}</div>;
}

const TOKEN = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g;

function inline(s: string): ReactNode[] {
  return s.split(TOKEN).map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    const md = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (md) return <a key={i} href={md[2]} target="_blank" rel="noreferrer">{md[1]}</a>;
    if (/^https?:\/\//.test(part)) {
      let label = part;
      try {
        label = new URL(part).hostname.replace('www.', '');
      } catch {
        /* keep raw */
      }
      return <a key={i} href={part} target="_blank" rel="noreferrer">{label}</a>;
    }
    return part;
  });
}

/** Textarea mit kleiner Formatierungsleiste; wächst mit dem Inhalt. */
export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  autoFocus,
  minRows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  const wrap = (before: string, after = before) => {
    const el = ref.current!;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = value.slice(a, b) || 'Text';
    const next = value.slice(0, a) + before + sel + after + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + sel.length);
    });
  };

  const prefixLines = (fn: (i: number) => string) => {
    const el = ref.current!;
    const start = value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    const endIdx = value.indexOf('\n', el.selectionEnd);
    const end = endIdx === -1 ? value.length : endIdx;
    const lines = value.slice(start, end).split('\n').map((l, i) => fn(i) + l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
    onChange(value.slice(0, start) + lines.join('\n') + value.slice(end));
    requestAnimationFrame(() => el.focus());
  };

  const addLink = () => {
    const url = prompt('Link (https://…)');
    if (url && /^https?:\/\//.test(url)) wrap('[', `](${url})`);
  };

  // Buttons dürfen den Fokus nicht stehlen, sonst feuert onBlur und der Editor schließt
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="rte">
      <div className="rte-bar" onMouseDown={keep}>
        <button type="button" title="Fett" onClick={() => wrap('**')}>
          <strong>B</strong>
        </button>
        <button type="button" title="Kursiv" onClick={() => wrap('*')}>
          <Italic size={15} />
        </button>
        <button type="button" title="Liste" onClick={() => prefixLines(() => '- ')}>
          <List size={15} />
        </button>
        <button type="button" title="Nummerierte Liste" onClick={() => prefixLines((i) => `${i + 1}. `)}>
          <ListOrdered size={15} />
        </button>
        <button type="button" title="Link" onClick={addLink}>
          <LinkIcon size={15} />
        </button>
      </div>
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        rows={minRows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}

/** Klick zum Bearbeiten; zeigt formatierten Text an. */
export function EditableRichText(p: { value: string; placeholder: string; disabled?: boolean; className?: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(p.value);
  useEffect(() => {
    if (!editing) setV(p.value);
  }, [p.value, editing]);

  if (editing && !p.disabled) {
    return (
      <RichTextEditor
        autoFocus
        value={v}
        onChange={setV}
        placeholder={p.placeholder}
        onBlur={() => {
          setEditing(false);
          if (v !== p.value) p.onSave(v);
        }}
      />
    );
  }
  return (
    <div className={`editable ${p.className ?? ''}${p.disabled ? '' : ' can'}`} onClick={(e) => !p.disabled && !(e.target as HTMLElement).closest('a') && setEditing(true)}>
      {p.value ? <RichTextView text={p.value} /> : <span className="muted">{p.disabled ? '' : p.placeholder}</span>}
    </div>
  );
}
