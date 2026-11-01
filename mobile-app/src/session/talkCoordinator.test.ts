import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TalkTarget } from '../protocol';
import type { SessionController } from './sessionController';
import { TalkCoordinator } from './talkCoordinator';
import { createHoldGesture } from '../talk/holdGesture';

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock('./state', () => ({ HOLD_HINT: 'Hold to talk', useSessionStore: { getState: () => store.state, setState: (patch: Record<string, unknown>) => { Object.assign(store.state, patch); } } }));
vi.mock('../talk/talkLink', () => ({ loadTalkLinkToken: vi.fn(), talkLinkAuthorizes: vi.fn() }));
const a: TalkTarget = { type: 'conference', id: 1, label: 'A', canTalk: true };
const b: TalkTarget = { type: 'conference', id: 2, label: 'B', canTalk: true };
beforeEach(() => { store.state = { peers: [], talking: false, talkLocked: false, lockedTargetKeys: [], talkingTargetKeys: [], lockMultipleTargets: false, error: null }; });

function fixture() {
  const media = { startTalking: vi.fn(async () => {}), syncTalkTargets: vi.fn(), stopTalking: vi.fn(async () => {}) };
  const c = { talkingTargets: [] as TalkTarget[], lockedTargets: [] as TalkTarget[], overrideFrom: null as TalkTarget[] | null, media,
    background: { prepareAudioForTalk: vi.fn(async () => {}), syncPresence: vi.fn() }, mediaCoordinator: { syncFeedDucking: vi.fn() } };
  return { c, media, talk: new TalkCoordinator(c as unknown as SessionController) };
}

describe('panel Talk ownership', () => {
  it('adds a second touch target while the first remains live and releases only the lifted finger', async () => {
    for (const first of [0, 1]) {
      const { c, talk, media } = fixture();
      const gestures = [createHoldGesture(), createHoldGesture()];
      const targets = [a, b]; const pending: Promise<void>[] = [];
      gestures.forEach((gesture, i) => gesture.start({ identifier: i, pageX: 100 }, {
        onPress: () => { pending.push(talk.pressTalk(targets[i]!, `touch:${i}`)); },
        onLock: () => { pending.push(talk.lockTalk(targets[i]!)); },
        onRelease: () => { pending.push(talk.releaseTalk(targets[i]!, `touch:${i}`)); },
      }));
      await Promise.all(pending.splice(0));
      expect(c.talkingTargets).toEqual([a, b]);
      expect(media.startTalking).toHaveBeenLastCalledWith([a, b], false, expect.any(Function));
      gestures.forEach(gesture => gesture.end([{ identifier: first, pageX: 100 }]));
      await Promise.all(pending.splice(0));
      expect(c.talkingTargets).toEqual([targets[1 - first]]); expect(media.stopTalking).not.toHaveBeenCalled();
      gestures.forEach(gesture => gesture.end([{ identifier: 1 - first, pageX: 100 }]));
      await Promise.all(pending.splice(0));
      expect(c.talkingTargets).toEqual([]); expect(media.stopTalking).toHaveBeenCalledOnce();
    }
  });

  it('releasing the main button leaves a separately held target transmitting', async () => {
    const { c, talk, media } = fixture();
    await talk.pressTalk(a, 'main'); await talk.pressTalk(b, 'row');
    await talk.releaseTalk(undefined, 'main');
    expect(c.talkingTargets).toEqual([b]); expect(media.stopTalking).not.toHaveBeenCalled();
    await talk.releaseTalk(b, 'row'); expect(c.talkingTargets).toEqual([]);
  });

  it('keeps a target live until both its name and talk-icon holds are released', async () => {
    const { c, talk, media } = fixture();
    await talk.pressTalk(a, 'row-name'); await talk.pressTalk(a, 'row-icon');
    await talk.releaseTalk(a, 'row-name'); expect(c.talkingTargets).toEqual([a]);
    expect(media.stopTalking).not.toHaveBeenCalled();
    await talk.releaseTalk(a, 'row-icon'); expect(c.talkingTargets).toEqual([]);
  });

  it('releases the touch-down target even if Reply now addresses a different caller', async () => {
    const { c, talk } = fixture();
    await talk.pressTalk(a, 'main'); await talk.pressTalk(b, 'row');
    await talk.releaseTalk(b, 'main'); expect(c.talkingTargets).toEqual([b]);
  });

  it('drops the finger hold after swipe-to-lock so removing the lock really stops it', async () => {
    store.state.lockMultipleTargets = true;
    const { c, talk } = fixture();
    await talk.pressTalk(a, 'row-a'); await talk.lockTalk(a); await talk.releaseTalk(a, 'row-a');
    await talk.lockRemote(b); await talk.unlockRemote(a);
    expect(c.lockedTargets).toEqual([b]); expect(c.talkingTargets).toEqual([b]);
  });

  it('ignores a released old press that completes after the same input starts a new hold', async () => {
    const { c, talk } = fixture(); let finish!: () => void;
    c.background.prepareAudioForTalk.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = talk.pressTalk(a, 'main'); await talk.releaseTalk(undefined, 'main');
    await talk.pressTalk(b, 'main'); finish(); await old;
    expect(c.talkingTargets).toEqual([b]);
  });
  it('does not release the local hold on the same target', async () => {
    const { c, talk, media } = fixture(); await talk.pressTalk(a); await talk.pressRemote('panel:p:hold', a);
    await talk.releaseRemote('panel:p:hold'); expect(c.talkingTargets).toEqual([a]); expect(media.stopTalking).not.toHaveBeenCalled();
    await talk.releaseTalk(a); expect(c.talkingTargets).toEqual([]); expect(media.stopTalking).toHaveBeenCalledOnce();
  });

  it('does not release a panel hold when the phone button is released', async () => {
    const { c, talk } = fixture(); await talk.pressRemote('panel:p:hold', a); await talk.pressTalk(a); await talk.releaseTalk(a);
    expect(c.talkingTargets).toEqual([a]); await talk.releaseRemote('panel:p:hold'); expect(c.talkingTargets).toEqual([]);
  });

  it('keeps other panels and other local targets active', async () => {
    const { c, talk } = fixture(); await talk.pressTalk(b); await talk.pressRemote('panel:p:hold', a); await talk.pressRemote('panel:q:hold', a);
    await talk.releaseRemote('panel:p:hold'); expect(c.talkingTargets).toEqual([b, a]);
    await talk.releaseRemote('panel:q:hold'); expect(c.talkingTargets).toEqual([b]);
    await talk.releaseRemote('panel:missing:hold'); expect(c.talkingTargets).toEqual([b]);
  });

  it('makes remote locks idempotent without creating an implicit held input', async () => {
    const { c, talk } = fixture(); await talk.lockRemote(a); await talk.lockRemote(a);
    expect(c.lockedTargets).toEqual([a]); await talk.releaseRemote('panel:p:main'); expect(c.talkingTargets).toEqual([a]);
    await talk.unlockRemote(a); expect(c.talkingTargets).toEqual([]); expect(c.lockedTargets).toEqual([]);
  });

  it('keeps both targets transmitting for multi-lock and removes only the requested lock', async () => {
    store.state.lockMultipleTargets = true; const { c, talk } = fixture();
    await talk.lockRemote(a); await talk.lockRemote(b); expect(c.talkingTargets).toEqual([a, b]); expect(c.lockedTargets).toEqual([a, b]);
    await talk.unlockRemote(a); expect(c.talkingTargets).toEqual([b]); expect(c.lockedTargets).toEqual([b]);
  });

  it('restores a local single lock after the last panel override is released', async () => {
    const { c, talk } = fixture(); await talk.lockTalk(a); await talk.pressRemote('panel:p:hold', b); await talk.pressRemote('panel:q:hold', b);
    expect(c.talkingTargets).toEqual([b]); await talk.releaseRemote('panel:p:hold'); expect(c.talkingTargets).toEqual([b]);
    await talk.releaseRemote('panel:q:hold'); expect(c.talkingTargets).toEqual([a]); expect(c.overrideFrom).toBeNull(); expect(c.lockedTargets).toEqual([a]);
  });

  it('preserves a multi-lock when an extra held target is released', async () => {
    store.state.lockMultipleTargets = true; const { c, talk } = fixture(); await talk.lockTalk(a); await talk.pressRemote('panel:p:hold', b);
    await talk.releaseRemote('panel:p:hold'); expect(c.talkingTargets).toEqual([a]); expect(c.lockedTargets).toEqual([a]);
  });

  it('cancels a released press still awaiting audio permission', async () => {
    const { c, talk, media } = fixture(); let finish!: () => void;
    c.background.prepareAudioForTalk.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const press = talk.pressRemote('panel:p:hold', a); await talk.releaseRemote('panel:p:hold'); finish(); await press;
    expect(media.startTalking).not.toHaveBeenCalled(); expect(c.talkingTargets).toEqual([]);
  });

  it('cancels pending local and panel input after explicit stop', async () => {
    const { c, talk, media } = fixture(); let finish!: () => void;
    c.background.prepareAudioForTalk.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const press = talk.pressRemote('panel:p:hold', a); await talk.unlockTalk(); finish(); await press;
    expect(media.startTalking).not.toHaveBeenCalled(); expect(c.talkingTargets).toEqual([]);
  });

  it('discards remote presses on disconnect while preserving local holds and locks', async () => {
    const { c, talk } = fixture(); store.state.lockMultipleTargets = true;
    await talk.lockTalk(a); await talk.pressTalk(b); await talk.pressRemote('panel:p:hold', b); talk.discardRemoteHolds();
    expect(c.talkingTargets).toEqual([a, b]); expect(c.lockedTargets).toEqual([a]);
    await talk.releaseTalk(b); expect(c.talkingTargets).toEqual([a]);
  });

  it('does not let a late failed press release a newer press with the same panel input key', async () => {
    const { c, talk, media } = fixture(); let reject!: (error: Error) => void;
    media.startTalking.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const old = talk.pressRemote('panel:p:hold', a);
    await vi.waitFor(() => expect(media.startTalking).toHaveBeenCalled());
    await talk.releaseRemote('panel:p:hold'); await talk.pressRemote('panel:p:hold', a);
    reject(new Error('Late microphone failure')); await expect(old).rejects.toThrow('Late microphone failure');
    expect(c.talkingTargets).toEqual([a]);
    await talk.releaseRemote('panel:p:hold'); expect(c.talkingTargets).toEqual([]);
  });

  it('propagates microphone failure to the panel and removes its hold', async () => {
    const { c, talk, media } = fixture(); media.startTalking.mockRejectedValueOnce(new Error('Microphone denied'));
    await expect(talk.pressRemote('panel:p:hold', a)).rejects.toThrow('Microphone denied'); expect(c.talkingTargets).toEqual([]);
    await talk.pressRemote('panel:p:hold', a); expect(c.talkingTargets).toEqual([a]);
  });
});
