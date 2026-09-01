import { useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { useShowdownClient, type LogEntry } from './src/useShowdownClient';

const LOBBY = 'lobby';

/**
 * Proves the core session layer end-to-end on a real client: connects,
 * authenticates as a guest, joins the lobby, and round-trips chat — while
 * `useShowdownClient` keeps the socket in step with the app's foreground/
 * background state.
 *
 * Deliberately just chat: battle rendering and the teambuilder are separate,
 * much larger pieces of work and do not belong on the screen that exists to
 * validate the connection layer.
 */
export default function App() {
  const { connectionState, session, username, authError, log, join, say } = useShowdownClient();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    // `join` is idempotent and re-run by the hook itself after every
    // reconnect, so re-joining here on every 'ready' transition (not just the
    // first) is intentional, not redundant.
    if (session === 'ready') join(LOBBY);
  }, [session, join]);

  const send = () => {
    const message = draft.trim();
    if (!message) return;
    say(LOBBY, message);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="auto" />

      <View style={styles.header}>
        <Text style={styles.title}>Showdown Mobile</Text>
        <StatusBadge connectionState={connectionState} session={session} />
      </View>

      {username && <Text style={styles.subtitle}>Connected as {username}</Text>}
      {authError && <Text style={styles.error}>{authError}</Text>}

      <FlatList
        style={styles.log}
        data={log}
        keyExtractor={item => String(item.id)}
        renderItem={({ item }: { item: LogEntry }) => (
          <Text style={styles.logLine}>{item.text}</Text>
        )}
        ListEmptyComponent={<Text style={styles.logLine}>Waiting for lobby chat…</Text>}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message #${LOBBY}`}
          onSubmitEditing={send}
          editable={session === 'ready'}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.sendButton, session !== 'ready' && styles.sendButtonDisabled]}
          onPress={send}
          disabled={session !== 'ready'}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function StatusBadge({
  connectionState,
  session,
}: {
  connectionState: string;
  session: string;
}) {
  const label = session === 'ready' ? 'online' : connectionState;
  const color =
    session === 'ready'
      ? '#2e7d32'
      : connectionState === 'reconnecting'
        ? '#ed6c02'
        : connectionState === 'connecting'
          ? '#ed6c02'
          : '#c62828';
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: Platform.OS === 'android' ? 32 : 60,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { color: '#555', marginTop: 4 },
  error: { color: '#c62828', marginTop: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  log: { flex: 1, marginTop: 16 },
  logLine: { paddingVertical: 3, color: '#222' },
  composer: { flexDirection: 'row', gap: 8, paddingVertical: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sendButton: {
    backgroundColor: '#1565c0',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: '#90a4ae' },
  sendButtonText: { color: '#fff', fontWeight: '600' },
});
