import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({
  Pressable: 'Pressable', StyleSheet: { create: (styles: object) => styles },
}));
import { SettingsButton } from './settingsChrome';

describe('settings buttons', () => {
  it('uses the standard press control for navigation and target actions', () => {
    const press = vi.fn();
    const button = SettingsButton({ onPress: press, children: '+', accessibilityLabel: 'Add targets' });
    expect(button.type).toBe('Pressable');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Add targets');
    button.props.onPress();
    expect(press).toHaveBeenCalledTimes(1);
  });
  it('forwards the disabled state', () => {
    expect(SettingsButton({ onPress() {}, children: '+', disabled: true }).props.disabled).toBe(true);
  });
});
