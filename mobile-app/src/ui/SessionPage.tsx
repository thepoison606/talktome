import { Alert, Pressable, Text, View } from 'react-native';

import { describePttDevicesSummary } from '../ble/bindings';
import { productionChoices, visibleProductionName } from '../protocol';
import { connectionHealthFromSession } from '../session/connectionHealth';
import { session, useSessionStore } from '../session/store';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import { TrashIcon } from './icons';
import { PrivacyPolicyLink } from './PrivacyPolicyLink';
import {
  SettingsActionRow,
  SettingsHint,
  SettingsNavRow,
  SettingsRow,
  SettingsSection,
  useSettingsStyles,
  useSettingsTheme,
} from './settingsChrome';

/** Root menu of the session sheet; each settings category opens directly. */
export function SessionPage({
  onClose,
  onOpenLayout,
  onOpenAudio,
  onOpenAccessories,
  onOpenDebug,
  onOpenProfiles,
}: {
  onClose: () => void;
  onOpenLayout: () => void;
  onOpenAudio: () => void;
  onOpenAccessories: () => void;
  onOpenDebug: () => void;
  onOpenProfiles: () => void;
}) {
  const store = useSessionStore();
  const styles = useSettingsStyles();
  const { scheme } = useSettingsTheme();
  const production = visibleProductionName(store.productionName);
  const choices = store.productions.length > 0 ? productionChoices(store.productions) : [];
  const connection = connectionHealthFromSession(store);

  const disconnect = () => {
    Alert.alert(
      'Disconnect?',
      'You will appear offline. Opening the app again reconnects you to this production.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            onClose();
            void session.disconnect();
          },
        },
      ],
    );
  };

  return (
    <>
      <SettingsSection title="Signed in as">
        <SettingsRow label={store.identity?.name ?? store.username} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Connection</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            <ConnectionStatusBadge health={connection} light={scheme === 'light'} />
          </View>
        </View>
        <SettingsRow label="Server" value={store.serverAddress} />
        {production && choices.length === 0 ? <SettingsRow label="Production" value={production} /> : null}
      </SettingsSection>

      {choices.length > 1 ? (
        <SettingsSection title="Production">
          {choices.map((choice) => {
            const selected = choice.id === store.productionId;
            return (
              <SettingsRow
                key={choice.id ?? 'default'}
                label={choice.name}
                value={selected ? 'Selected' : ''}
                selected={selected}
                onPress={() => {
                  void session.selectProduction(
                    choice.id === null ? null : { id: choice.id, name: choice.name },
                  );
                }}
              />
            );
          })}
        </SettingsSection>
      ) : null}

      <SettingsSection>
        <SettingsNavRow label="Layout" onPress={onOpenLayout} />
        <SettingsNavRow label="Audio" onPress={onOpenAudio} />
        <SettingsNavRow
          label="Accessories"
          value={describePttDevicesSummary(store.bleBindings, store.bleDevices)}
          onPress={onOpenAccessories}
        />
        <SettingsNavRow label="Debug" onPress={onOpenDebug} />
      </SettingsSection>

      <SettingsSection>
        <SettingsNavRow label="Profiles" onPress={onOpenProfiles} />
        <Pressable accessibilityRole="button" onPress={disconnect} style={[styles.row, styles.actionTop]}>
          <Text style={[styles.navLabel, styles.destructiveLabel]}>Disconnect</Text>
        </Pressable>
      </SettingsSection>
      <SettingsSection title="About">
        <PrivacyPolicyLink settings />
      </SettingsSection>
    </>
  );
}

/**
 * Session › Profiles. Opening it changes nothing; picking another profile, adding one, or scanning
 * a QR code leaves this session first, then continues on the profile screens.
 */
export function ProfilesPage({ onClose }: { onClose: () => void }) {
  const profiles = useSessionStore((state) => state.profiles);
  const activeProfileId = useSessionStore((state) => state.activeProfileId);
  const styles = useSettingsStyles();
  const { palette } = useSettingsTheme();

  const leaveThen = (next: () => void | Promise<void>) => {
    onClose();
    void session.leaveToProfiles().then(next);
  };

  return (
    <>
      <SettingsSection>
        {profiles.map((profile, index) => {
          const current = profile.id === activeProfileId;
          const production = visibleProductionName(profile.productionName);
          return (
            <View key={profile.id} style={[styles.orderRow, index > 0 && styles.orderRowDivider]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                disabled={current}
                onPress={() => leaveThen(() => session.connectProfile(profile.id))}
                style={styles.orderText}
              >
                <Text style={styles.orderName} numberOfLines={1}>
                  {profile.username}
                </Text>
                <Text style={styles.orderKind} numberOfLines={1}>
                  {production ? `${profile.serverAddress} · ${production}` : profile.serverAddress}
                </Text>
              </Pressable>
              {current ? (
                <Text style={[styles.rowValue, styles.profileCurrent]}>Connected</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${profile.username}`}
                  hitSlop={8}
                  style={styles.orderButton}
                  onPress={() =>
                    Alert.alert('Remove profile?', `${profile.username}\n${profile.serverAddress}`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => void session.removeSavedProfile(profile.id),
                      },
                    ])
                  }
                >
                  <TrashIcon color={palette.danger} />
                </Pressable>
              )}
            </View>
          );
        })}
        <SettingsHint
          full="You stay connected until you pick another profile. Picking, adding, or scanning disconnects this session first."
          compact="You stay connected until you pick another profile."
        />
      </SettingsSection>

      <SettingsSection>
        <SettingsActionRow label="Add profile" onPress={() => leaveThen(() => session.startAddProfile())} />
        <SettingsActionRow
          label="Scan QR code"
          onPress={() => leaveThen(() => session.startAddProfile({ openScanner: true }))}
        />
      </SettingsSection>
    </>
  );
}
