import { create } from 'zustand';
import { talkTargetIdentity, type TalkTarget } from '../protocol';

// Key feedback is independent of actual transmission: an offline destination
// still lights up while held, but must never be reported as transmitting.
export const useKeyboardActivity = create<{ targetKeys: string[] }>(() => ({ targetKeys: [] }));
export function publishKeyboardHolds(targets: TalkTarget[]): void {
  const targetKeys = [...new Set(targets.map(talkTargetIdentity))];
  const previous = useKeyboardActivity.getState().targetKeys;
  if (previous.length === targetKeys.length && previous.every((key, index) => key === targetKeys[index])) return;
  useKeyboardActivity.setState({ targetKeys });
}
