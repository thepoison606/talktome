import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { isCompactOperatorScreen } from './layers';
import { settingsPalette, settingsScheme, type SettingsPalette, type SettingsScheme } from './settingsTheme';

type SettingsStyles = ReturnType<typeof makeSettingsStyles>;

type SettingsThemeValue = {
  scheme: SettingsScheme;
  palette: SettingsPalette;
  styles: SettingsStyles;
};

const SettingsThemeContext = createContext<SettingsThemeValue | null>(null);

export function SettingsThemeProvider({
  scheme,
  children,
}: {
  scheme: string | null | undefined;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    const resolved = settingsScheme(scheme);
    const palette = settingsPalette(resolved);
    return { scheme: resolved, palette, styles: makeSettingsStyles(palette) };
  }, [scheme]);
  return <SettingsThemeContext.Provider value={value}>{children}</SettingsThemeContext.Provider>;
}

export function useSettingsTheme(): SettingsThemeValue {
  const value = useContext(SettingsThemeContext);
  if (!value) {
    const palette = settingsPalette('light');
    return { scheme: 'light', palette, styles: makeSettingsStyles(palette) };
  }
  return value;
}

export function useSettingsStyles(): SettingsStyles {
  return useSettingsTheme().styles;
}

export function SettingsButton({ onPress, children, disabled = false, ...props }: {
  onPress: () => void;
  children: ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <Pressable {...props} onPress={onPress} disabled={disabled} accessibilityRole="button">{children}</Pressable>;
}

type HeaderProps = {
  title: string;
  backLabel?: string;
  onBack?: () => void;
  onDone?: () => void;
  onAdd?: () => void;
};

export function SettingsHeader({ title, backLabel = 'Settings', onBack, onDone, onAdd }: HeaderProps) {
  const styles = useSettingsStyles();
  const { width, height } = useWindowDimensions();
  const compact = isCompactOperatorScreen(width, height);
  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      {onBack ? (
        <SettingsButton onPress={onBack} hitSlop={8}>
          <Text style={styles.navLink}>‹ {backLabel}</Text>
        </SettingsButton>
      ) : (
        <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={1}>
          {title}
        </Text>
      )}
      {onBack ? (
        <Text style={styles.nestedTitle} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      {onAdd ? (
        <SettingsButton onPress={onAdd} accessibilityLabel="Add targets" hitSlop={8}>
          <Text style={[styles.done, { fontSize: 26 }]}>＋</Text>
        </SettingsButton>
      ) : onDone ? (
        <SettingsButton onPress={onDone}>
          <Text style={styles.done}>Done</Text>
        </SettingsButton>
      ) : (
        <View style={styles.doneSpacer} />
      )}
    </View>
  );
}

export function SettingsSection({
  title,
  children,
  style,
}: {
  title?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useSettingsStyles();
  return (
    <View style={[styles.section, style]}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function SettingsRow({
  label,
  value,
  selected,
  multiple = false,
  onPress,
}: {
  label: string;
  value?: string;
  selected?: boolean;
  multiple?: boolean;
  onPress?: () => void;
}) {
  const styles = useSettingsStyles();
  const { palette } = useSettingsTheme();
  const content = (
    <>
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {multiple ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={{ width: 20, height: 20, marginLeft: 10, borderWidth: 1, borderRadius: 4,
            borderColor: selected ? palette.link : palette.muted, alignItems: 'center', justifyContent: 'center' }}>
          {selected ? <Text style={{ color: palette.link, fontSize: 15, lineHeight: 18 }}>✓</Text> : null}
        </View>
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        style={[styles.row, selected && styles.rowSelected]}
        onPress={onPress}
        accessibilityRole={multiple ? 'checkbox' : 'button'}
        accessibilityState={multiple ? { checked: selected === true } : selected === undefined ? undefined : { selected }}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.row, selected && styles.rowSelected]}>{content}</View>;
}

export function SettingsNavRow({
  label,
  value,
  subtitle,
  onPress,
}: {
  label: string;
  value?: string;
  subtitle?: string;
  onPress: () => void;
}) {
  const styles = useSettingsStyles();
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowText}>
        <Text style={styles.navLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export function SettingsActionRow({
  label,
  onPress,
  destructive,
  disabled,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const styles = useSettingsStyles();
  return (
    <SettingsButton style={styles.row} onPress={onPress} disabled={disabled}>
      <Text
        style={[
          styles.actionLabel,
          destructive && styles.destructiveLabel,
          disabled && styles.disabledLabel,
        ]}
      >
        {label}
      </Text>
    </SettingsButton>
  );
}

export function SettingsFootnote({ children }: { children: ReactNode }) {
  const styles = useSettingsStyles();
  return <Text style={styles.footnote}>{children}</Text>;
}

export function SettingsHint({ full, compact }: { full: string; compact: string }) {
  const styles = useSettingsStyles();
  const { width, height } = useWindowDimensions();
  const short = isCompactOperatorScreen(width, height);
  return <Text style={[styles.footnote, short && styles.footnoteCompact]}>{short ? compact : full}</Text>;
}

export function SettingsSwitchRow({
  label,
  value,
  onValueChange,
  trackColor = '#3DD6F5',
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  trackColor?: string;
}) {
  const styles = useSettingsStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: trackColor }} />
    </View>
  );
}

function makeSettingsStyles(palette: SettingsPalette) {
  return StyleSheet.create({
    sheet: {
      flex: 1,
      backgroundColor: palette.sheet,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 12,
      gap: 12,
    },
    headerCompact: {
      paddingTop: 12,
      paddingBottom: 8,
    },
    title: {
      fontSize: 34,
      fontWeight: '700',
      color: palette.text,
      flex: 1,
    },
    titleCompact: {
      fontSize: 26,
    },
    nestedTitle: {
      flex: 1,
      fontSize: 17,
      fontWeight: '600',
      color: palette.text,
      textAlign: 'center',
      marginBottom: 4,
    },
    navLink: {
      color: palette.link,
      fontSize: 17,
      fontWeight: '400',
      marginBottom: 4,
      minWidth: 72,
    },
    done: {
      color: palette.link,
      fontSize: 17,
      fontWeight: '600',
      marginBottom: 6,
      minWidth: 48,
      textAlign: 'right',
    },
    doneSpacer: {
      minWidth: 48,
      marginBottom: 6,
    },
    scroll: {
      flex: 1,
      minHeight: 0,
    },
    body: {
      padding: 16,
      gap: 18,
    },
    section: {
      backgroundColor: palette.card,
      borderRadius: 12,
      overflow: 'hidden',
    },
    sectionTitle: {
      color: palette.muted,
      fontSize: 13,
      fontWeight: '600',
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 6,
      textTransform: 'uppercase',
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: 48,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    rowSelected: {
      backgroundColor: palette.selected,
    },
    rowText: {
      flex: 1,
      paddingRight: 12,
    },
    rowLabel: {
      color: palette.text,
      fontSize: 16,
      flex: 1,
      paddingRight: 12,
    },
    navLabel: {
      color: palette.text,
      fontSize: 16,
    },
    rowSubtitle: {
      color: palette.muted,
      fontSize: 13,
      paddingTop: 2,
    },
    rowValue: {
      color: palette.muted,
      fontSize: 16,
      flexShrink: 1,
      textAlign: 'right',
      marginLeft: 12,
    },
    chevron: {
      color: palette.chevron,
      fontSize: 22,
      lineHeight: 22,
      fontWeight: '500',
      marginLeft: 6,
      marginTop: -1,
    },
    sliderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    sliderHint: {
      color: palette.muted,
      fontSize: 13,
      fontVariant: ['tabular-nums'],
      width: 32,
    },
    actionLabel: {
      color: palette.link,
      fontSize: 16,
      fontWeight: '600',
    },
    destructiveLabel: {
      color: palette.danger,
    },
    disabledLabel: {
      color: palette.disabled,
    },
    footnote: {
      color: palette.muted,
      fontSize: 13,
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    footnoteCompact: {
      fontSize: 12,
      paddingBottom: 8,
    },
    pairingHero: {
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingVertical: 36,
      gap: 12,
    },
    pairingTitle: {
      color: palette.text,
      fontSize: 22,
      fontWeight: '700',
      textAlign: 'center',
    },
    pairingBody: {
      color: palette.muted,
      fontSize: 16,
      textAlign: 'center',
      lineHeight: 22,
    },
    pairingTimer: {
      color: palette.text,
      fontSize: 34,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      paddingTop: 8,
    },
    actionTop: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.separator,
    },
    profileCurrent: {
      marginRight: 8,
    },
    orderList: {
      paddingBottom: 0,
    },
    orderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 16,
      paddingRight: 8,
      paddingVertical: 8,
      gap: 8,
    },
    orderRowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.separator,
    },
    orderText: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 4,
    },
    orderName: {
      color: palette.text,
      fontSize: 16,
    },
    orderKind: {
      color: palette.muted,
      fontSize: 13,
      paddingTop: 2,
    },
    orderButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}

/** Light-mode layout fallback for callers that cannot use the theme hook. */
export const settingsStyles = makeSettingsStyles(settingsPalette('light'));
