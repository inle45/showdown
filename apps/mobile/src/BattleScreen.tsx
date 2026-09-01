import { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { BattleHandle } from './useBattle';

/**
 * Renders one live battle and lets the connected account make choices.
 *
 * Deliberately singles-only for now: doubles/triples need per-slot target
 * selection and multiple simultaneous choices, and team-preview reordering
 * here is tap-to-append rather than drag-to-reorder. No sprites or move
 * animations — `packages/battle` established that the *state* this would
 * render is trustworthy (30-replay regression corpus); this screen is the
 * first thing to actually render it, not to gold-plate it before that's
 * proven on a real live match.
 */
export function BattleScreen({ handle }: { handle: BattleHandle }) {
  const { battle, log, request, perspective } = handle;
  const mySide = perspective === 'p2' ? battle.p2 : battle.p1;
  const theirSide = perspective === 'p2' ? battle.p1 : battle.p2;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.tier}>{battle.tier || 'Battle'}</Text>
        <Text style={styles.turn}>Turn {battle.turn}</Text>
      </View>

      <ActiveRow side={theirSide} label={theirSide.name || 'Opponent'} />
      <ActiveRow side={mySide} label={mySide.name || 'You'} />

      <FlatList
        style={styles.log}
        data={log}
        keyExtractor={item => String(item.id)}
        renderItem={({ item }) => <Text style={styles.logLine}>{item.text}</Text>}
        ListEmptyComponent={<Text style={styles.logLine}>Battle starting…</Text>}
      />

      <ChoicePanel handle={handle} />

      {!request && (
        <Text style={styles.waiting}>
          {battle.turn > 0 ? 'Waiting for the opponent…' : 'Waiting for the battle to start…'}
        </Text>
      )}
    </View>
  );
}

function ActiveRow({ side, label }: { side: BattleHandle['battle']['p1']; label: string }) {
  const active = side.active[0];
  return (
    <View style={styles.activeRow}>
      <Text style={styles.activeLabel}>{label}</Text>
      {active ? (
        <>
          <Text style={styles.activeName}>
            {active.speciesForme}
            {active.fainted ? ' (fainted)' : ''}
          </Text>
          <View style={styles.hpBarTrack}>
            <View
              style={[
                styles.hpBarFill,
                {
                  width: `${active.maxhp ? Math.max(0, (active.hp / active.maxhp) * 100) : 0}%`,
                  backgroundColor: hpColor(active.hp, active.maxhp),
                },
              ]}
            />
          </View>
          {active.status && <Text style={styles.status}>{active.status.toUpperCase()}</Text>}
        </>
      ) : (
        <Text style={styles.activeName}>—</Text>
      )}
    </View>
  );
}

function hpColor(hp: number, maxhp: number): string {
  if (!maxhp) return '#c62828';
  const fraction = hp / maxhp;
  if (fraction > 0.5) return '#2e7d32';
  if (fraction > 0.2) return '#ed6c02';
  return '#c62828';
}

function ChoicePanel({ handle }: { handle: BattleHandle }) {
  const { request, chooseMove, chooseSwitch, chooseTeamOrder } = handle;
  const [teraActive, setTeraActive] = useState(false);
  const [teamOrder, setTeamOrder] = useState<number[]>([]);

  if (!request) return null;

  if (request.requestType === 'team') {
    const teamSize = request.side.pokemon.length;
    const toggle = (slot: number) => {
      const next = teamOrder.includes(slot) ? teamOrder.filter(s => s !== slot) : [...teamOrder, slot];
      setTeamOrder(next);
      if (next.length === teamSize) {
        chooseTeamOrder(next);
        setTeamOrder([]);
      }
    };
    return (
      <View style={styles.choices}>
        <Text style={styles.sectionLabel}>
          Team preview — tap in lead order ({teamOrder.length}/{teamSize})
        </Text>
        <View style={styles.buttonRow}>
          {request.side.pokemon.map((mon, i) => {
            const slot = i + 1;
            const picked = teamOrder.includes(slot);
            return (
              <TouchableOpacity
                key={slot}
                style={[styles.choiceButton, picked && styles.choiceButtonPicked]}
                onPress={() => toggle(slot)}
              >
                <Text style={styles.choiceButtonText}>
                  {picked ? `${teamOrder.indexOf(slot) + 1}. ` : ''}
                  {mon.details.split(',')[0]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  if (request.requestType === 'wait') {
    return null;
  }

  const active = request.requestType === 'move' ? request.active[0] : null;
  const forceSwitch = request.requestType === 'switch' ? request.forceSwitch[0] : false;
  const showMoves = active && !forceSwitch;
  const showSwitches = forceSwitch || (active?.trapped !== true);

  return (
    <View style={styles.choices}>
      {showMoves && active && (
        <>
          <View style={styles.buttonRow}>
            {active.moves.map((move, i) => {
              const disabled = 'disabled' in move && move.disabled;
              return (
                <TouchableOpacity
                  key={move.id}
                  style={[styles.choiceButton, disabled && styles.choiceButtonDisabled]}
                  disabled={!!disabled}
                  onPress={() => chooseMove(i + 1, teraActive ? { terastallize: true } : undefined)}
                >
                  <Text style={styles.choiceButtonText}>{move.name}</Text>
                  {'pp' in move && (
                    <Text style={styles.ppText}>
                      {move.pp}/{move.maxpp}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          {active.canTerastallize && (
            <TouchableOpacity
              style={[styles.teraToggle, teraActive && styles.teraToggleActive]}
              onPress={() => setTeraActive(t => !t)}
            >
              <Text style={[styles.teraToggleText, teraActive && styles.teraToggleTextActive]}>
                Tera{teraActive ? ` (${active.canTerastallize}) ✓` : ` (${active.canTerastallize})`}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {showSwitches && (
        <View style={styles.buttonRow}>
          {request.side.pokemon.map((mon, i) => {
            if (mon.active || mon.condition.startsWith('0')) return null;
            return (
              <TouchableOpacity
                key={mon.ident}
                style={styles.choiceButton}
                onPress={() => chooseSwitch(i + 1)}
              >
                <Text style={styles.choiceButtonText}>{mon.details.split(',')[0]}</Text>
                <Text style={styles.ppText}>{mon.condition}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  tier: { fontWeight: '600' },
  turn: { color: '#555' },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ddd',
  },
  activeLabel: { width: 70, fontSize: 12, color: '#777' },
  activeName: { fontWeight: '600', flexShrink: 0 },
  hpBarTrack: { flex: 1, height: 8, backgroundColor: '#e0e0e0', borderRadius: 4, overflow: 'hidden' },
  hpBarFill: { height: '100%' },
  status: { fontSize: 11, fontWeight: '700', color: '#c62828' },
  log: { flex: 1, marginVertical: 8 },
  logLine: { paddingVertical: 2, color: '#222' },
  waiting: { textAlign: 'center', color: '#777', paddingVertical: 12 },
  choices: { paddingVertical: 8, gap: 8 },
  sectionLabel: { fontSize: 12, color: '#555' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceButton: {
    backgroundColor: '#1565c0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 90,
  },
  choiceButtonDisabled: { backgroundColor: '#90a4ae' },
  choiceButtonPicked: { backgroundColor: '#2e7d32' },
  choiceButtonText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  ppText: { color: '#e3f2fd', fontSize: 11, textAlign: 'center' },
  teraToggle: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#7b1fa2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  teraToggleActive: { backgroundColor: '#7b1fa2' },
  teraToggleText: { color: '#7b1fa2', fontWeight: '600' },
  teraToggleTextActive: { color: '#fff' },
});
