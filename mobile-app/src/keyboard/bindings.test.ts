import { describe, expect, it } from 'vitest';
import { keyAssignments, keyBinding, KeyboardHolds, readKeyOverrides, wireKeyOverrides } from './bindings';
import type { TalkTarget } from '../protocol';

const user: TalkTarget = { type: 'user', id: 2, label: 'Director', canTalk: true };
const conference: TalkTarget = { type: 'conference', id: 3, label: 'Crew', canTalk: true };
const feed: TalkTarget = { type: 'feed', id: 4, label: 'Feed', canTalk: false };

describe('hardware keyboard assignments', () => {
  it('uses Space for the configured main and 1–9 for talk targets, excluding feeds and listen-only conferences', () => {
    const rows = keyAssignments([user, feed, { ...conference, canTalk: false }, conference], {}, conference, user);
    expect(rows.map(row => [row.identity, row.binding?.label])).toEqual([['main', 'Space'], ['reply', undefined], ['user-2', '1'], ['conference-3', '2']]);
    expect(rows[0]?.target).toBe(conference);
    expect(keyBinding('Numpad1')?.id).toBe(keyBinding('Digit1')?.id);
  });

  it('claims custom keys first, shifts remaining default digits and keeps customs with targets after reordering', () => {
    const overrides = { 'conference-3': keyBinding('Digit1')!, main: keyBinding('KeyM')! };
    const rows = keyAssignments([user, conference], overrides, user, conference);
    expect(rows.map(row => row.binding?.label)).toEqual(['M', 'Space', '2', '1']);
    expect(keyAssignments([conference, user], overrides, user, conference).find(row => row.identity === 'conference-3')?.binding?.label).toBe('1');
  });

  it('normalizes stored data and ignores malformed codes and inherited object keys', () => {
    expect(readKeyOverrides({ main: { type: 'code', value: 'Space' }, 'user-2': { type: 'digit', value: '2' }, bad: { type: 'code', value: 'Space' }, reply: { type: 'code', value: 'ShiftLeft' } })).toEqual({ main: keyBinding('Space'), 'user-2': keyBinding('Digit2') });
    expect(keyBinding('ShiftLeft')).toBeNull();
    expect(keyBinding('__proto__')).toBeNull();
    expect(readKeyOverrides(null)).toEqual({});
  });
  it('round-trips web-client target identities and binding objects', () => {
    const web = { 'user:2': keyBinding('KeyA')!, 'conference:3': keyBinding('Digit8')!, main: keyBinding('Space')! };
    const native = readKeyOverrides(web);
    expect(native['user-2']?.value).toBe('KeyA');
    expect(wireKeyOverrides(native)).toEqual(web);
  });
});

describe('keyboard held PTT', () => {
  function fixture() {
    const starts: [TalkTarget, string][] = [], ends: string[] = [];
    return { starts, ends, holds: new KeyboardHolds((target, key) => starts.push([target, key]), key => ends.push(key)) };
  }
  it('ignores auto-repeat and releases the original input after reorder, changed Reply or bindings', () => {
    const f = fixture();
    const rows = keyAssignments([user, conference], {}, conference, user);
    f.holds.event('Space', true, rows);
    f.holds.event('Space', true, rows);
    f.holds.event('Digit1', true, rows);
    expect(f.starts).toEqual([[conference, 'keyboard:Space'], [user, 'keyboard:Digit1']]);
    f.holds.event('Space', false, keyAssignments([conference, user], { main: keyBinding('KeyM')! }, user, conference));
    expect(f.ends).toEqual(['keyboard:Space']);
    f.holds.event('Digit1', false, []);
    expect(f.ends).toEqual(['keyboard:Space', 'keyboard:Digit1']);
  });

  it('keeps number row and numpad holds independent, and resets every held key on focus loss', () => {
    const f = fixture(), rows = keyAssignments([user], {}, null, null);
    f.holds.event('Digit1', true, rows);
    f.holds.event('Numpad1', true, rows);
    f.holds.event('Digit1', false, rows);
    expect(f.ends).toEqual(['keyboard:Digit1']);
    f.holds.reset(); f.holds.reset();
    f.holds.event('Numpad1', false, rows);
    expect(f.ends).toEqual(['keyboard:Digit1', 'keyboard:Numpad1']);
  });

  it('does not start unavailable Main or an unsupported key', () => {
    const f = fixture(), rows = keyAssignments([user], {}, null, null);
    f.holds.event('Space', true, rows); f.holds.event('ShiftLeft', true, rows);
    f.holds.reset();
    expect(f.starts).toEqual([]); expect(f.ends).toEqual([]);
  });
});
