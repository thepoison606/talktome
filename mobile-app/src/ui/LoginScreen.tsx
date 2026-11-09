import { useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { SessionConflictError, TlsUntrustedError } from '../auth/errors';
import { parseConnectPayload } from '../servers/parseConnectPayload';
import { formatFingerprint } from '../servers/fingerprint';
import { session, useSessionStore } from '../session/store';
import { QrIcon } from './icons';
import { QrScannerModal } from './QrScannerModal';
import { PrivacyPolicyLink } from './PrivacyPolicyLink';
import { isCompactOperatorScreen } from './layers';
import { colors } from './theme';

type LoginMethod = 'account' | 'link';

export function LoginScreen() {
  const store = useSessionStore();
  const { width, height } = useWindowDimensions();
  const compact = isCompactOperatorScreen(width, height);
  const [method, setMethod] = useState<LoginMethod>('account');
  const [password, setPassword] = useState('');
  const [loginLink, setLoginLink] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const guest = store.loginOptions?.guestLogin;
  const canGoBack = store.profiles.length > 0;

  const openLoginScanner = useSessionStore((state) => state.openLoginScanner);
  const setField = useSessionStore((state) => state.setField);

  useEffect(() => {
    if (store.hydrated) {
      setPassword((current) => current || session.rememberedPassword());
    }
  }, [store.hydrated]);

  useEffect(() => {
    if (openLoginScanner) {
      setScanning(true);
      setField('openLoginScanner', false);
    }
  }, [openLoginScanner, setField]);

  useEffect(() => {
    if (store.serverAddress.trim()) {
      const handle = setTimeout(() => {
        void session.refreshLoginOptions(store.serverAddress);
      }, 400);
      return () => clearTimeout(handle);
    }
    return undefined;
  }, [store.serverAddress]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      if (error instanceof SessionConflictError) {
        useSessionStore.setState({
          status: 'idle',
          conflictName: error.existing?.name ?? store.username,
          error: null,
        });
      } else if (error instanceof TlsUntrustedError) {
        const pending = useSessionStore.getState().pendingCertificate;
        useSessionStore.setState({
          status: 'idle',
          statusMessage: pending ? 'This certificate is not in the system trust store.' : '',
          error: pending ? null : error.message,
        });
      } else {
        useSessionStore.setState({
          status: 'idle',
          statusMessage: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const signInWithLink = (raw: string, force = false) => {
    if (/^http:\/\//i.test(raw.trim())) {
      useSessionStore.setState({
        error: 'The server address must use HTTPS.',
        statusMessage: '',
      });
      return Promise.resolve();
    }
    const parsed = parseConnectPayload(raw);
    const serverAddress = parsed.serverAddress || store.serverAddress;
    if (!parsed.token) {
      useSessionStore.setState({
        error: 'Paste a TalkToMe login link that includes #login=.',
        statusMessage: '',
      });
      return Promise.resolve();
    }
    if (!serverAddress.trim()) {
      useSessionStore.setState({
        error: 'This login link is missing a server address.',
        statusMessage: '',
      });
      return Promise.resolve();
    }
    setMethod('link');
    setLoginLink(raw.trim());
    if (parsed.serverAddress) {
      store.setField('serverAddress', parsed.serverAddress);
    }
    return session.loginWithToken({
      serverAddress,
      token: parsed.token,
      rememberPassword: true,
      force,
    });
  };

  const submit = (force = false) =>
    run(() => {
      if (method === 'link') {
        return signInWithLink(loginLink, force);
      }
      return session.login({
        serverAddress: store.serverAddress,
        username: store.username,
        password,
        rememberPassword: store.rememberPassword,
        force,
      });
    });

  const applyLoginLink = (value: string) => {
    setLoginLink(value);
    const parsed = parseConnectPayload(value);
    if (parsed.token) {
      if (parsed.serverAddress) {
        store.setField('serverAddress', parsed.serverAddress);
      }
      return;
    }
    if (parsed.serverAddress && !parsed.token) {
      store.setField('serverAddress', parsed.serverAddress);
      setMethod('account');
      setLoginLink('');
    }
  };

  const applyServerInput = (value: string) => {
    const parsed = parseConnectPayload(value);
    if (parsed.token) {
      setMethod('link');
      setLoginLink(value.trim());
      if (parsed.serverAddress) {
        store.setField('serverAddress', parsed.serverAddress);
      }
      return;
    }
    store.setField('serverAddress', value);
  };

  const applyScanned = (raw: string) => {
    setScanning(false);
    if (/^http:\/\//i.test(raw.trim())) {
      useSessionStore.setState({ error: 'The server address must use HTTPS.', statusMessage: '' });
      return;
    }
    const parsed = parseConnectPayload(raw);
    if (!parsed.serverAddress && !parsed.token) {
      useSessionStore.setState({ error: 'This QR code is not a TalkToMe server or login link.' });
      return;
    }
    if (parsed.token) {
      void run(() => signInWithLink(raw));
      return;
    }
    setMethod('account');
    store.setField('serverAddress', parsed.serverAddress ?? '');
    useSessionStore.setState({ error: null, statusMessage: 'Server filled from QR code. Enter your account.' });
  };

  const openScanner = () => {
    useSessionStore.setState({ error: null, statusMessage: '' });
    setScanning(true);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, compact && styles.screenCompact]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scrollFill}
        contentContainerStyle={[styles.scroll, compact && styles.scrollCompact]}
        keyboardShouldPersistTaps="handled"
      >
        {canGoBack ? (
          <Pressable accessibilityRole="button" onPress={() => session.cancelAddProfile()} style={styles.back}>
            <Text style={styles.backText}>Profiles</Text>
          </Pressable>
        ) : null}
        <View style={[styles.intro, compact && styles.introCompact]}>
          <View style={styles.brandRow}>
            <Image
              source={require('../../assets/talktome-mark.png')}
              style={[styles.brandIcon, compact && styles.brandIconCompact]}
            />
            <Text style={[styles.brand, compact && styles.brandCompact]}>talktome</Text>
          </View>
          <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>
            Connect with an operator account or a login link.
          </Text>
        </View>

        <View style={[styles.card, compact && styles.cardCompact]}>
          <View style={styles.segment} accessibilityRole="tablist">
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: method === 'account' }}
              style={[styles.segmentItem, method === 'account' && styles.segmentItemOn]}
              onPress={() => setMethod('account')}
            >
              <Text style={[styles.segmentText, method === 'account' && styles.segmentTextOn]}>Account</Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: method === 'link' }}
              style={[styles.segmentItem, method === 'link' && styles.segmentItemOn]}
              onPress={() => setMethod('link')}
            >
              <Text style={[styles.segmentText, method === 'link' && styles.segmentTextOn]}>Login link</Text>
            </Pressable>
          </View>

          {method === 'account' ? (
            <>
              <Text style={styles.label}>Server</Text>
              <ScanField
                accessibilityLabel="Server"
                keyboardType="url"
                placeholder="https://intercom.local"
                value={store.serverAddress}
                onChangeText={applyServerInput}
                onScan={openScanner}
                scanLabel="Scan server QR"
              />

              <Text style={styles.label}>Username</Text>
              <TextInput
                accessibilityLabel="Username"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Username"
                placeholderTextColor="#8A8F99"
                style={styles.input}
                value={store.username}
                onChangeText={(value) => store.setField('username', value)}
              />

              <Text style={styles.label}>Password</Text>
              <TextInput
                accessibilityLabel="Password"
                secureTextEntry
                placeholder="Password"
                placeholderTextColor="#8A8F99"
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => void submit()}
              />

              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Remember password</Text>
                <Switch
                  value={store.rememberPassword}
                  onValueChange={(value) => store.setField('rememberPassword', value)}
                  trackColor={{ true: colors.accent }}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Login link</Text>
              <ScanField
                accessibilityLabel="Login link"
                keyboardType="url"
                placeholder="https://host/#login=…"
                value={loginLink}
                onChangeText={applyLoginLink}
                onScan={openScanner}
                scanLabel="Scan login QR"
                onSubmitEditing={() => void submit()}
              />
              <Text style={styles.hint}>
                Use a personal login link from TalkToMe. It already includes the server.
              </Text>
            </>
          )}

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Allow self-signed local TLS</Text>
            <Switch
              value={store.allowInsecureLocalTLS}
              onValueChange={(value) => store.setField('allowInsecureLocalTLS', value)}
              trackColor={{ true: colors.accent }}
            />
          </View>
          <Text style={styles.hint}>
            {compact
              ? 'Pin a local certificate fingerprint. TLS stays on.'
              : 'When a local certificate is not in the system store, TalkToMe can pin its SHA-256 fingerprint. This never disables TLS checks for every host.'}
          </Text>

          {store.pendingCertificate ? (
            <View style={styles.trust}>
              <Text style={styles.trustTitle}>Trust this certificate?</Text>
              <Text style={styles.trustBody}>{store.pendingCertificate.hostname}</Text>
              <Text style={styles.fingerprint}>
                SHA-256 {formatFingerprint(store.pendingCertificate.sha256)}
              </Text>
              {store.pendingCertificate.issuer ? (
                <Text style={styles.trustBody}>{store.pendingCertificate.issuer}</Text>
              ) : null}
              <Pressable
                style={styles.takeOver}
                onPress={() => void run(() => session.acceptCertificateAndRetry('user'))}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={styles.takeOverText}>{busy ? 'Trusting…' : 'Trust and continue'}</Text>
              </Pressable>
            </View>
          ) : null}

          {store.conflictName ? (
            <View style={styles.conflict}>
              <Text style={styles.conflictTitle}>User already signed in</Text>
              <Text style={styles.conflictBody}>
                This user is already signed in on another session ({store.conflictName}). You can
                disconnect that session and take it over.
              </Text>
              <Pressable
                style={styles.takeOver}
                onPress={() => void run(() => session.takeOver())}
                disabled={busy}
                accessibilityRole="button"
              >
                <Text style={styles.takeOverText}>
                  {busy ? 'Taking over...' : 'Take over other session'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {store.error ? <Text style={styles.error}>{store.error}</Text> : null}
          {store.statusMessage ? <Text style={styles.status}>{store.statusMessage}</Text> : null}
        </View>
        <PrivacyPolicyLink />
      </ScrollView>

      <View style={styles.actions}>
        {method === 'account' && guest?.enabled ? (
          <Pressable
            accessibilityRole="button"
            style={[styles.guest, busy && styles.buttonDisabled]}
            onPress={() =>
              void run(() =>
                session.loginGuest({
                  serverAddress: store.serverAddress,
                  displayName: store.username,
                }),
              )
            }
            disabled={busy}
          >
            <Text style={styles.guestText}>
              {busy ? 'Signing in…' : `Continue as ${guest.label || 'Guest'}`}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={[styles.signIn, busy && styles.buttonDisabled]}
          onPress={() => void submit()}
          disabled={busy}
        >
          <Text style={styles.signInText}>{busy ? 'Signing in…' : 'Sign In'}</Text>
        </Pressable>
      </View>
      <QrScannerModal visible={scanning} onClose={() => setScanning(false)} onScanned={applyScanned} />
    </KeyboardAvoidingView>
  );
}

function ScanField({
  accessibilityLabel,
  keyboardType,
  placeholder,
  value,
  onChangeText,
  onScan,
  scanLabel,
  onSubmitEditing,
}: {
  accessibilityLabel: string;
  keyboardType: 'url';
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  onScan: () => void;
  scanLabel: string;
  onSubmitEditing?: () => void;
}) {
  return (
    <View style={styles.inputWrap}>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor="#8A8F99"
        style={styles.inputInWrap}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={scanLabel}
        hitSlop={8}
        onPress={onScan}
        style={styles.inputScan}
      >
        <QrIcon color="#111318" size={18} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
  },
  screenCompact: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  scrollFill: {
    flex: 1,
    minHeight: 0,
  },
  scroll: {
    paddingBottom: 16,
  },
  scrollCompact: {
    paddingBottom: 8,
  },
  back: {
    alignSelf: 'flex-start',
    marginBottom: 12,
    paddingVertical: 6,
  },
  backText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 16,
  },
  intro: {
    marginTop: 4,
    marginBottom: 16,
  },
  introCompact: {
    marginTop: 0,
    marginBottom: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
  },
  brandIconCompact: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  brand: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '700',
  },
  brandCompact: {
    fontSize: 26,
  },
  subtitle: {
    color: colors.muted,
    marginTop: 6,
    fontSize: 16,
  },
  subtitleCompact: {
    fontSize: 13,
    marginTop: 4,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
  },
  cardCompact: {
    padding: 14,
    borderRadius: 18,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: 12,
    padding: 3,
    marginBottom: 6,
  },
  segmentItem: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentItemOn: {
    backgroundColor: 'rgba(61,214,245,0.22)',
  },
  segmentText: {
    color: colors.muted,
    fontWeight: '700',
    fontSize: 15,
  },
  segmentTextOn: {
    color: colors.text,
  },
  label: {
    color: colors.muted,
    marginBottom: 6,
    marginTop: 14,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    color: '#111318',
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  inputInWrap: {
    flex: 1,
    color: '#111318',
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
  },
  inputScan: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  toggleLabel: {
    color: colors.text,
    flex: 1,
    paddingRight: 12,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 10,
  },
  trust: {
    marginTop: 16,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(61,214,245,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(61,214,245,0.34)',
  },
  trustTitle: {
    color: colors.text,
    fontWeight: '700',
  },
  trustBody: {
    color: colors.muted,
    marginTop: 8,
    fontSize: 13,
  },
  fingerprint: {
    color: colors.text,
    marginTop: 8,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  conflict: {
    marginTop: 16,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,120,71,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,120,71,0.34)',
  },
  conflictTitle: {
    color: colors.text,
    fontWeight: '700',
  },
  conflictBody: {
    color: colors.muted,
    marginTop: 8,
    fontSize: 13,
  },
  takeOver: {
    marginTop: 12,
    backgroundColor: '#FF7847',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  takeOverText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  error: {
    color: colors.danger,
    marginTop: 12,
  },
  status: {
    color: colors.muted,
    marginTop: 8,
  },
  actions: {
    gap: 10,
  },
  guest: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  guestText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 16,
  },
  signIn: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  signInText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 18,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
