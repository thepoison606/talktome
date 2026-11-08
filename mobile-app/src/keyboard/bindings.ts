import { talkTargetIdentity, type TalkTarget } from '../protocol';

export type KeyBinding = { id: string; type: 'digit' | 'code'; value: string; label: string };
export type KeyOverrides = Record<string, KeyBinding>;
export type KeyAssignment = { identity: string; label: string; binding: KeyBinding | null; target: TalkTarget | null };

const labels: Record<string, string> = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/' };

export function keyBinding(code: string): KeyBinding | null {
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code)?.[1];
  if (digit) return { id: `digit:${digit}`, type: 'digit', value: digit, label: digit };
  if (!/^(Key[A-Z]|F([1-9]|1[0-9]|2[0-4])|Numpad(Enter|Add|Subtract|Multiply|Divide|Decimal))$/.test(code) && !Object.hasOwn(labels, code)) return null;
  return { id: `code:${code}`, type: 'code', value: code, label: labels[code] ?? code.replace(/^Key/, '') };
}

export function readKeyOverrides(value: unknown): KeyOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: KeyOverrides = {};
  for (const [storedIdentity, raw] of Object.entries(value)) {
    const identity = storedIdentity.replace(/^(user|conference|guest):/, '$1-');
    if (!/^(main|reply|(?:user|conference|guest)-[^\s]+)$/.test(identity) || !raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<KeyBinding>;
    const binding = entry.type === 'digit' ? keyBinding(`Digit${entry.value}`) : entry.type === 'code' && typeof entry.value === 'string' ? keyBinding(entry.value) : null;
    if (binding) result[identity] = binding;
  }
  return result;
}

export function wireKeyOverrides(overrides: KeyOverrides): KeyOverrides {
  return Object.fromEntries(Object.entries(overrides).map(([identity, binding]) => [identity.replace(/^(user|conference|guest)-/, '$1:'), binding]));
}

/** Same ordering and claimed-digit behavior as the web client's target hotkeys. */
export function keyAssignments(targets: TalkTarget[], overrides: KeyOverrides, main: TalkTarget | null, reply: TalkTarget | null): KeyAssignment[] {
  const rows: KeyAssignment[] = [
    { identity: 'main', label: 'Main button', target: main, binding: null },
    { identity: 'reply', label: 'Reply', target: reply, binding: null },
    ...targets.filter(t => t.type !== 'feed' && t.canTalk).map(target => ({ identity: talkTargetIdentity(target), label: target.label, target, binding: null })),
  ];
  const claimed = new Map<string, string>();
  for (const row of rows) {
    const custom = overrides[row.identity];
    if (custom && !claimed.has(custom.id)) { row.binding = custom; claimed.set(custom.id, row.identity); }
  }
  let digit = 1;
  for (const row of rows) {
    if (row.binding) continue;
    if (row.identity === 'main' || row.identity === 'reply') {
      const space = keyBinding('Space')!;
      if (!claimed.has(space.id)) { row.binding = space; claimed.set(space.id, row.identity); }
      continue;
    }
    while (digit <= 9 && claimed.has(`digit:${digit}`)) digit++;
    if (digit <= 9) { row.binding = keyBinding(`Digit${digit++}`); claimed.set(row.binding!.id, row.identity); }
  }
  return rows;
}

/** Resolve at key-down and release that exact input, even after reordering or a new Reply. */
export class KeyboardHolds {
  private held = new Map<string, TalkTarget>();
  constructor(private readonly press: (target: TalkTarget, inputKey: string) => void, private readonly release: (inputKey: string) => void,
    private readonly onHeldChange: (targets: TalkTarget[]) => void = () => {}) {}
  event(code: string, pressed: boolean, assignments: KeyAssignment[]): void {
    const key = `keyboard:${code}`;
    if (!pressed) {
      if (this.held.delete(key)) {
        this.onHeldChange([...this.held.values()]);
        this.release(key);
      }
      return;
    }
    if (this.held.has(key)) return;
    const binding = keyBinding(code);
    if (!binding) return;
    const target = assignments.find(row => row.binding?.id === binding?.id)?.target;
    if (!target) return;
    this.held.set(key, target);
    this.onHeldChange([...this.held.values()]);
    this.press(target, key);
  }
  reset(): void {
    if (!this.held.size) return;
    const keys = [...this.held.keys()];
    this.held.clear();
    this.onHeldChange([]);
    keys.forEach(key => this.release(key));
  }
}
