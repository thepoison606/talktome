import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { visibleProductionName } from '../protocol';
import { session, useSessionStore } from '../session/store';
import { QrIcon, TrashIcon } from './icons';
import { PrivacyPolicyLink } from './PrivacyPolicyLink';
import { colors } from './theme';

export function ProfilePickerScreen() {
  const profiles = useSessionStore((state) => state.profiles);
  const lastProfileId = useSessionStore((state) => state.activeProfileId);
  const busy = useSessionStore((state) => state.status === 'connecting');
  const error = useSessionStore((state) => state.error);
  const statusMessage = useSessionStore((state) => state.statusMessage);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Profiles</Text>
      <Text style={styles.subtitle}>Tap a profile to connect. The trash can deletes it from this device.</Text>

      <ScrollView contentContainerStyle={styles.list}>
        {profiles.map((profile) => {
          const production = visibleProductionName(profile.productionName);
          return (
            <View key={profile.id} style={[styles.card, profile.id === lastProfileId && styles.cardLast]}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void session.connectProfile(profile.id)}
                style={[styles.cardMain, busy && styles.busy]}
              >
                <Text style={styles.name}>{profile.username}</Text>
                <Text style={styles.server}>{profile.serverAddress}</Text>
                {production ? <Text style={styles.production}>{production}</Text> : null}
                {busy && profile.id === lastProfileId ? (
                  <View style={styles.connection} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={styles.server}>{statusMessage || 'Connecting…'}</Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${profile.username}`}
                disabled={busy}
                onPress={() => {
                  Alert.alert('Remove profile?', `${profile.username}\n${profile.serverAddress}`, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => void session.removeSavedProfile(profile.id),
                    },
                  ]);
                }}
                hitSlop={8}
                style={styles.remove}
              >
                <TrashIcon />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {busy ? (
        <Pressable accessibilityRole="button" onPress={() => session.cancelProfileConnection()} style={styles.add}>
          <Text style={styles.addText}>Cancel connection</Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => session.startAddProfile({ openScanner: true })}
        style={styles.add}
      >
        <View style={styles.addRow}>
          <QrIcon color={colors.text} />
          <Text style={styles.addText}>Scan QR code</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => session.startAddProfile()} style={styles.add}>
        <Text style={styles.addText}>Add profile</Text>
      </Pressable>
      <PrivacyPolicyLink />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    marginTop: 6,
    marginBottom: 20,
  },
  list: {
    gap: 10,
    paddingBottom: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardLast: {
    borderColor: 'rgba(61,214,245,0.45)',
  },
  cardMain: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  name: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  server: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  production: {
    color: colors.accent,
    fontSize: 13,
    marginTop: 6,
    fontWeight: '600',
  },
  remove: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: colors.danger,
    marginBottom: 8,
  },
  add: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  addText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  busy: {
    opacity: 0.6,
  },
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
});
