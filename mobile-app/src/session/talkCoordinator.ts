import { canTalkToTarget, talkTargetIdentity, type TalkTarget } from '../protocol';
import { mainButtonStorageKey, resolveMainButton, type ResolvedMainButton } from './mainButton';
import {
  saveConferenceListen,
  setConferenceMemberLevel as nextConferenceMemberLevel,
  setConferenceMemberListening as nextConferenceMemberListening,
  type ConferenceListenState,
} from './conferenceListen';
import { resolveReplyTalkTarget } from '../talk/replyTarget';
import { loadTalkLinkToken, talkLinkAuthorizes } from '../talk/talkLink';
import { addTalkTarget, removeTalkTarget, talkTargetKeys } from '../talk/talkSet';
import { HOLD_HINT, useSessionStore } from './state';
import type { SessionController } from './sessionController';

/** Press/lock/release talk, the main button, and conference listen. */
export class TalkCoordinator {
  private localHolds = new Map<string, { target: TalkTarget }>();
  private remoteHolds = new Map<string, { target: TalkTarget }>();
  private generation = 0;

  constructor(private readonly c: SessionController) {}

  canTalkTo(target: TalkTarget): boolean {
    return canTalkToTarget(target, useSessionStore.getState().peers);
  }

  async pressTalk(target: TalkTarget, inputKey = talkTargetIdentity(target)): Promise<void> {
    if (!this.canTalkTo(target) || !this.c.media) {
      useSessionStore.setState({ error: !this.c.media ? 'Media is not ready.' : target.type === 'user' ? 'This target is currently offline.' : 'This target is listen-only.' });
      return;
    }
    if (this.localHolds.has(inputKey)) return;
    const generation = this.generation;
    const hold = { target };
    try {
      const state = useSessionStore.getState();
      if (state.talkLocked && this.isLocked(target) && this.c.overrideFrom === null) {
        if (state.lockMultipleTargets && this.c.lockedTargets.length > 1) await this.removeLock(target);
        else await this.unlockTalk();
        return;
      }
      this.localHolds.set(inputKey, hold);
      await this.startHold(target, () => this.localHolds.get(inputKey) === hold);
    } catch (error) {
      if (generation === this.generation && this.localHolds.get(inputKey) === hold) this.failTalk(error);
    }
  }

  private async startHold(target: TalkTarget, stillHeld: () => boolean): Promise<void> {
    if (!this.canTalkTo(target)) throw new Error('This target is currently unavailable.');
    const media = this.c.media;
    if (!media) throw new Error('Media is not ready.');
    const generation = this.generation;
    await this.c.background.prepareAudioForTalk();
    if (generation !== this.generation || !stillHeld() || media !== this.c.media) return;

    if (this.isLocked(target) && this.c.overrideFrom === null) return;
    const state = useSessionStore.getState();
    if (this.c.lockedTargets.length && !state.lockMultipleTargets && this.c.overrideFrom === null) {
      this.c.overrideFrom = this.c.lockedTargets;
      this.c.talkingTargets = [];
    }
    this.c.talkingTargets = addTalkTarget(this.c.talkingTargets, target);
    this.publishTalkState(this.c.lockedTargets.length > 0);
    await media.startTalking(this.c.talkingTargets, this.mediaTalkState().lockActive, () => this.mediaTalkState());
  }

  async pressRemote(inputKey: string, target: TalkTarget): Promise<void> {
    if (this.remoteHolds.has(inputKey)) return;
    const hold = { target };
    this.remoteHolds.set(inputKey, hold);
    try {
      await this.startHold(target, () => this.remoteHolds.get(inputKey) === hold);
    } catch (error) {
      if (this.remoteHolds.get(inputKey) === hold) await this.releaseRemote(inputKey);
      throw error;
    }
  }

  async releaseRemote(inputKey: string): Promise<void> {
    const hold = this.remoteHolds.get(inputKey);
    if (!hold) return;
    this.remoteHolds.delete(inputKey);
    if (!this.hasHold(hold.target)) await this.finishRelease(hold.target);
  }

  async lockRemote(target: TalkTarget): Promise<void> {
    if (this.isLocked(target)) return;
    if (!this.canTalkTo(target) || !this.c.media) throw new Error('Talk target is not available.');
    const generation = this.generation;
    await this.c.background.prepareAudioForTalk();
    if (generation !== this.generation) return;
    this.c.lockedTargets = useSessionStore.getState().lockMultipleTargets
      ? addTalkTarget(this.c.lockedTargets, target) : [target];
    this.c.overrideFrom = null;
    this.c.talkingTargets = this.c.lockedTargets.reduce(addTalkTarget, this.c.talkingTargets.filter(item => this.hasHold(item)));
    this.publishTalkState(true);
    try {
      await this.c.media.startTalking(this.c.talkingTargets, true, () => this.mediaTalkState());
    } catch (error) {
      if (generation === this.generation) this.failTalk(error);
      throw error;
    }
  }

  async unlockRemote(target: TalkTarget): Promise<void> {
    if (!this.isLocked(target)) return;
    if (this.c.overrideFrom) this.c.overrideFrom = removeTalkTarget(this.c.overrideFrom, target);
    await this.removeLock(target);
  }

  /** A lost socket discards panel presses; local presses and deliberate locks survive. */
  discardRemoteHolds(): void {
    const owned = [...this.remoteHolds.values()].map(hold => talkTargetIdentity(hold.target));
    this.remoteHolds.clear();
    this.generation++;
    if (!owned.length) return;
    this.c.talkingTargets = this.c.talkingTargets.filter(target =>
      !owned.includes(talkTargetIdentity(target)) || this.hasHold(target) || this.isLocked(target));
    if (this.c.overrideFrom && !this.c.talkingTargets.some(target => this.hasHold(target))) {
      this.c.talkingTargets = this.c.lockedTargets;
      this.c.overrideFrom = null;
    }
    this.publishTalkState(this.c.lockedTargets.length > 0);
    if (this.c.talkingTargets.length) this.c.media?.syncTalkTargets(this.c.talkingTargets, this.mediaTalkState().lockActive);
    else void this.c.media?.stopTalking().catch(() => {});
  }

  private hasHold(target: TalkTarget): boolean {
    const key = talkTargetIdentity(target);
    return [...this.localHolds.values(), ...this.remoteHolds.values()].some(hold => talkTargetIdentity(hold.target) === key);
  }

  private isLocked(target: TalkTarget): boolean {
    return this.c.lockedTargets.some(item => talkTargetIdentity(item) === talkTargetIdentity(target));
  }

  private mediaTalkState(): { targets: TalkTarget[]; lockActive: boolean } {
    return { targets: this.c.talkingTargets, lockActive: this.c.overrideFrom === null && this.c.lockedTargets.length > 0 };
  }

  async lockTalk(target: TalkTarget): Promise<void> {
    const media = this.c.media;
    if (!this.canTalkTo(target) || !media) {
      return;
    }
    const generation = this.generation;
    await this.c.background.prepareAudioForTalk();
    if (generation !== this.generation || media !== this.c.media) return;
    this.c.talkingTargets = addTalkTarget(this.c.talkingTargets, target);
    // Multi-lock adds this target to the existing lock set; single-lock
    // locks the whole current talking set (previous locks were already
    // replaced by the pressTalk override path).
    this.c.lockedTargets =
      useSessionStore.getState().lockMultipleTargets && this.c.lockedTargets.length > 0
        ? addTalkTarget(this.c.lockedTargets, target)
        : this.c.talkingTargets;
    this.c.overrideFrom = null;
    this.publishTalkState(true);
    try {
      await media.startTalking(this.c.talkingTargets, true, () => this.mediaTalkState());
      useSessionStore.setState({
        statusMessage: `Locked to ${this.c.talkingTargets.map((item) => item.label).join(', ')}.`,
      });
    } catch (error) {
      if (generation === this.generation) this.failTalk(error);
    }
  }

  async releaseTalk(target?: TalkTarget, inputKey?: string): Promise<void> {
    if (target || inputKey != null) {
      const key = inputKey ?? talkTargetIdentity(target!);
      const heldTarget = this.localHolds.get(key)?.target;
      this.localHolds.delete(key);
      if (!heldTarget || this.hasHold(heldTarget)) return;
      await this.finishRelease(heldTarget);
    } else {
      this.localHolds.clear();
      for (const current of [...this.c.talkingTargets]) {
        if (!this.hasHold(current)) await this.finishRelease(current);
      }
    }
  }

  private async finishRelease(target: TalkTarget): Promise<void> {
    if (this.c.overrideFrom) {
      this.c.talkingTargets = removeTalkTarget(this.c.talkingTargets, target);
      if (this.c.talkingTargets.some(item => this.hasHold(item))) {
        this.publishTalkState(true);
        this.c.media?.syncTalkTargets(this.c.talkingTargets, false);
        return;
      }
      this.c.talkingTargets = this.c.lockedTargets;
      this.c.overrideFrom = null;
    } else if (!this.isLocked(target)) {
      this.c.talkingTargets = removeTalkTarget(this.c.talkingTargets, target);
    }
    this.publishTalkState(this.c.lockedTargets.length > 0);
    if (this.c.talkingTargets.length) {
      this.c.media?.syncTalkTargets(this.c.talkingTargets, this.mediaTalkState().lockActive);
    } else {
      await this.c.media?.stopTalking();
    }
  }

  async pressReply(): Promise<void> {
    const reply = this.replyTalkTarget();
    if (!reply) {
      useSessionStore.setState({ error: 'No one to reply to.' });
      return;
    }
    await this.pressTalk(reply);
  }

  async lockReply(): Promise<void> {
    const reply = this.replyTalkTarget();
    if (!reply) {
      return;
    }
    await this.lockTalk(reply);
  }

  replyTalkTarget(): TalkTarget | null {
    return useSessionStore.getState().replyTarget;
  }

  resolvedMainButton(): ResolvedMainButton {
    const state = useSessionStore.getState();
    return resolveMainButton({
      storedIdentity: state.mainButtonTargets[mainButtonStorageKey(state.activeProfileId, state.productionId)],
      targets: state.targets,
      replyTarget: state.replyTarget,
      canTalk: (target) => this.canTalkTo(target),
    });
  }

  async pressMainButton(): Promise<void> {
    const resolved = this.resolvedMainButton();
    if (!resolved.target) {
      useSessionStore.setState({
        error: resolved.unavailable ? 'That main button target is unavailable.' : 'No one to reply to.',
      });
      return;
    }
    if (resolved.mode === 'reply') {
      await this.pressReply();
      return;
    }
    await this.pressTalk(resolved.target);
  }

  async lockMainButton(): Promise<void> {
    const resolved = this.resolvedMainButton();
    if (!resolved.target) {
      return;
    }
    if (resolved.mode === 'reply') {
      await this.lockReply();
      return;
    }
    await this.lockTalk(resolved.target);
  }

  firstTalkableTarget(): TalkTarget | null {
    return useSessionStore.getState().targets.find((target) => this.canTalkTo(target)) ?? null;
  }

  async toggleCurrentTalk(): Promise<void> {
    const state = useSessionStore.getState();
    if (!state.operatorReady) {
      return;
    }
    if (state.talking || state.talkLocked) {
      await this.unlockTalk();
      return;
    }
    await this.lockMainButton();
  }

  handleTalkUrl(url: string): void {
    void this.acceptTalkUrl(url);
  }

  private async acceptTalkUrl(url: string): Promise<void> {
    const token = await loadTalkLinkToken().catch(() => null);
    if (!talkLinkAuthorizes(url, token) || !useSessionStore.getState().operatorReady) {
      return;
    }
    void this.toggleCurrentTalk();
  }

  setConferenceMemberListening(conferenceId: number | string, userId: number, listening: boolean): void {
    const next = nextConferenceMemberListening(
      useSessionStore.getState().conferenceListen,
      conferenceId,
      userId,
      listening,
    );
    void this.applyConferenceListen(next);
  }

  setConferenceMemberLevel(conferenceId: number | string, userId: number, level: number): void {
    const next = nextConferenceMemberLevel(
      useSessionStore.getState().conferenceListen,
      conferenceId,
      userId,
      level,
    );
    void this.applyConferenceListen(next);
  }

  async applyConferenceListen(next: ConferenceListenState): Promise<void> {
    useSessionStore.setState({ conferenceListen: next });
    this.c.media?.setConferenceListen(next);
    await saveConferenceListen(next);
  }

  refreshReplyTarget(): void {
    const state = useSessionStore.getState();
    const replyTarget = resolveReplyTalkTarget({
      incoming: state.incoming,
      targets: state.targets,
      peers: state.peers,
      lastReply: state.replyTarget,
      fallback: this.firstTalkableTarget(),
    });
    useSessionStore.setState({ replyTarget });
    this.c.background.syncPresence();
  }

  /** Drops one lock from a multi-lock set; stops talking if it was the last. */
  private async removeLock(target: TalkTarget): Promise<void> {
    this.c.lockedTargets = removeTalkTarget(this.c.lockedTargets, target);
    if (!this.hasHold(target)) this.c.talkingTargets = removeTalkTarget(this.c.talkingTargets, target);
    if (this.c.talkingTargets.length === 0) {
      await this.unlockTalk();
      return;
    }
    this.publishTalkState(this.c.lockedTargets.length > 0);
    this.c.media?.syncTalkTargets(this.c.talkingTargets, this.mediaTalkState().lockActive);
  }

  /** Called when multi-lock is switched off while several locks are active. */
  async collapseToSingleLock(): Promise<void> {
    const keep = this.c.lockedTargets[0];
    if (this.c.lockedTargets.length <= 1 || !keep) {
      return;
    }
    this.c.lockedTargets = [keep];
    this.c.talkingTargets = [keep];
    this.publishTalkState(true);
    this.c.media?.syncTalkTargets(this.c.talkingTargets, true);
    useSessionStore.setState({ statusMessage: `Locked to ${keep.label}.` });
  }

  async unlockTalk(target?: TalkTarget): Promise<void> {
    if (
      target &&
      useSessionStore.getState().lockMultipleTargets &&
      this.c.lockedTargets.length > 1 &&
      this.c.lockedTargets.some((item) => talkTargetIdentity(item) === talkTargetIdentity(target))
    ) {
      await this.removeLock(target);
      return;
    }
    this.generation++;
    this.localHolds.clear();
    this.remoteHolds.clear();
    this.c.talkingTargets = [];
    this.c.lockedTargets = [];
    this.c.overrideFrom = null;
    this.publishTalkState(false);
    await this.c.media?.stopTalking();
  }

  private failTalk(error: unknown): void {
    this.generation++;
    this.localHolds.clear();
    this.remoteHolds.clear();
    this.c.talkingTargets = [];
    this.c.lockedTargets = [];
    this.c.overrideFrom = null;
    this.publishTalkState(false);
    useSessionStore.setState({
      error: error instanceof Error ? error.message : String(error),
      statusMessage: 'PTT could not start.',
    });
  }

  publishTalkState(locked: boolean): void {
    const keys = talkTargetKeys(this.c.talkingTargets);
    const lockedKeys = talkTargetKeys(this.c.lockedTargets);
    const overriding = this.c.overrideFrom !== null;
    useSessionStore.setState({
      talking: this.c.talkingTargets.length > 0,
      talkLocked: locked && this.c.lockedTargets.length > 0,
      talkingTargetKeys: keys,
      lockedTargetKeys: locked ? lockedKeys : [],
      error: null,
      statusMessage:
        this.c.talkingTargets.length > 0
          ? locked && !overriding
            ? `Locked to ${this.c.talkingTargets.map((item) => item.label).join(', ')}.`
            : `Talking to ${this.c.talkingTargets.map((item) => item.label).join(', ')}…`
          : HOLD_HINT,
    });
    this.c.background.syncPresence();
    this.c.mediaCoordinator.syncFeedDucking();
  }
}
