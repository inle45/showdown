import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { BattleScreen } from './src/BattleScreen';
import { theme } from './src/theme';
import { useBattle } from './src/useBattle';
import { useShowdownClient, type LogEntry } from './src/useShowdownClient';

const LOBBY = 'lobby';
/** Formats offered by the quick-search buttons, newest generation first. */
const QUICK_FORMATS = [
  { id: 'gen9randombattle', label: 'Random Battle' },
  { id: 'gen9ou', label: 'Gen 9 OU' },
  { id: 'gen9randomdoublesbattle', label: 'Random Doubles' },
];

/**
 * Connects, authenticates, and shows either the lobby or — once a battle
 * room appears (the server routes to it automatically; no `/join` needed) —
 * the battle screen. `useShowdownClient` keeps the socket in step with the
 * app's foreground/background state throughout.
 */
export default function App() {
  const { client, connectionState, session, username, authError, log, join, say } =
    useShowdownClient();
  const battle = useBattle(client);
  const [draft, setDraft] = useState('');
  const [searching, setSearching] = useState<string | null>(null);

  useEffect(() => {
    // `join` is idempotent and re-run by the hook itself after every
    // reconnect, so re-joining here on every 'ready' transition (not just the
    // first) is intentional, not redundant.
    if (session === 'ready') join(LOBBY);
  }, [session, join]);

  // A battle starting means the search that queued it is done.
  useEffect(() => {
    if (battle) setSearching(null);
  }, [battle]);

  const send = () => {
    const message = draft.trim();
    if (!message) return;
    say(LOBBY, message);
    setDraft('');
  };

  const search = (format: string) => {
    say(LOBBY, `/search ${format}`);
    setSearching(format);
  };

  const cancelSearch = () => {
    if (searching) say(LOBBY, `/cancelsearch ${searching}`);
    setSearching(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Showdown</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {username ? username.trim() : 'connecting…'}
            </Text>
          </View>
          <StatusBadge connectionState={connectionState} session={session} />
        </View>

        {authError && <Text style={styles.error}>{authError}</Text>}

        {battle ? (
          <BattleScreen handle={battle} />
        ) : (
          <>
            <SearchBar
              disabled={session !== 'ready'}
              searching={searching}
              onSearch={search}
              onCancel={cancelSearch}
            />
            <ChatLog log={log} />
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder={`Message #${LOBBY}`}
                placeholderTextColor={theme.color.textMuted}
                onSubmitEditing={send}
                editable={session === 'ready'}
                returnKeyType="send"
              />
              <TouchableOpacity
                style={[styles.sendButton, session !== 'ready' && styles.buttonDisabled]}
                onPress={send}
                disabled={session !== 'ready'}
              >
                <Text style={styles.sendText}>Send</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SearchBar({
  disabled,
  searching,
  onSearch,
  onCancel,
}: {
  disabled: boolean;
  searching: string | null;
  onSearch(format: string): void;
  onCancel(): void;
}) {
  if (searching) {
    const label = QUICK_FORMATS.find(f => f.id === searching)?.label ?? searching;
    return (
      <View style={styles.searchBar}>
        <Text style={styles.searchingText}>Searching for a {label} match…</Text>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.searchBar}>
      {QUICK_FORMATS.map(format => (
        <TouchableOpacity
          key={format.id}
          style={[styles.searchButton, disabled && styles.buttonDisabled]}
          disabled={disabled}
          onPress={() => onSearch(format.id)}
        >
          <Text style={styles.searchButtonText}>{format.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ChatLog({ log }: { log: LogEntry[] }) {
  const listRef = useRef<FlatList<LogEntry>>(null);
  return (
    <FlatList
      ref={listRef}
      style={styles.log}
      data={log}
      keyExtractor={item => String(item.id)}
      renderItem={({ item }) => <ChatLine entry={item} />}
      ListEmptyComponent={<Text style={styles.logMuted}>Waiting for lobby chat…</Text>}
      onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
    />
  );
}

function ChatLine({ entry }: { entry: LogEntry }) {
  const separator = entry.text.indexOf(':');
  if (separator <= 0) return <Text style={styles.chatText}>{entry.text}</Text>;
  return (
    <Text style={styles.chatLine}>
      <Text style={styles.chatAuthor}>{entry.text.slice(0, separator).trim()}</Text>
      <Text style={styles.chatText}>{entry.text.slice(separator)}</Text>
    </Text>
  );
}

function StatusBadge({
  connectionState,
  session,
}: {
  connectionState: string;
  session: string;
}) {
  const online = session === 'ready';
  const pending = connectionState === 'connecting' || connectionState === 'reconnecting';
  const color = online ? theme.color.good : pending ? theme.color.warn : theme.color.bad;
  return (
    <View style={styles.badge}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={styles.badgeText}>{online ? 'online' : connectionState}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.bg },
  container: {
    flex: 1,
    paddingHorizontal: theme.space(4),
    paddingTop: Platform.OS === 'android' ? theme.space(6) : 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: theme.space(2),
  },
  titleBlock: { flexShrink: 1 },
  title: { color: theme.color.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: theme.color.textMuted, fontSize: 12 },
  error: { color: theme.color.bad, paddingVertical: theme.space(1) },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(1.5),
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1.5),
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { color: theme.color.textMuted, fontSize: 11, fontWeight: '600' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.space(2),
    paddingVertical: theme.space(2),
  },
  searchButton: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(2),
  },
  searchButtonText: { color: theme.color.accentText, fontWeight: '700', fontSize: 12 },
  searchingText: { color: theme.color.textMuted, flex: 1, fontSize: 13 },
  cancelButton: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1.5),
  },
  cancelText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '600' },
  buttonDisabled: { opacity: 0.4 },

  log: { flex: 1 },
  logMuted: { color: theme.color.textMuted, fontStyle: 'italic' },
  chatLine: { paddingVertical: 2, fontSize: 13, lineHeight: 18 },
  chatAuthor: { color: theme.color.accent, fontWeight: '700' },
  chatText: { color: theme.color.text },

  composer: { flexDirection: 'row', gap: theme.space(2), paddingVertical: theme.space(3) },
  input: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2.5),
    color: theme.color.text,
  },
  sendButton: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(5),
    justifyContent: 'center',
  },
  sendText: { color: theme.color.accentText, fontWeight: '700' },
});
