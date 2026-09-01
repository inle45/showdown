import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { TYPE_COLORS, getBattleSprite, getMoveType } from '@showdown-mobile/battle';

import { PokemonIcon } from './PokemonIcon';
import { STATUS_COLORS, hpColor, theme } from './theme';
import type { BattleHandle } from './useBattle';

type Side = BattleHandle['battle']['p1'];
type ActivePokemon = Side['active'][number];

/**
 * The battle scene: both active Pokémon with animated sprites, a running
 * log, and the choice controls for whatever the server is currently asking
 * for.
 *
 * Still singles-only — doubles needs per-slot targeting, which changes the
 * control layout enough to be its own piece of work. See the README's known
 * gaps.
 */
export function BattleScreen({ handle }: { handle: BattleHandle }) {
  const { battle, log, request, perspective } = handle;
  const mySideId = perspective === 'p2' ? 'p2' : 'p1';
  const theirSideId = mySideId === 'p1' ? 'p2' : 'p1';
  const mySide = battle[mySideId];
  const theirSide = battle[theirSideId];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.tier} numberOfLines={1}>
          {battle.tier || 'Battle'}
        </Text>
        <View style={styles.turnPill}>
          <Text style={styles.turnText}>Turn {battle.turn}</Text>
        </View>
      </View>

      <View style={styles.field}>
        <Combatant
          side={theirSide}
          spriteSide="p2"
          gen={battle.gen?.num}
          align="flex-end"
          label="Opponent"
        />
        <Combatant
          side={mySide}
          spriteSide="p1"
          gen={battle.gen?.num}
          align="flex-start"
          label="You"
        />
      </View>

      <BattleLog log={log} />

      <ChoicePanel handle={handle} />
    </View>
  );
}

function Combatant({
  side,
  spriteSide,
  gen,
  align,
  label,
}: {
  side: Side;
  spriteSide: 'p1' | 'p2';
  gen: number | undefined;
  align: 'flex-start' | 'flex-end';
  label: string;
}) {
  const active: ActivePokemon = side.active[0] ?? null;

  return (
    <View style={[styles.combatant, { alignItems: align }]}>
      <View style={[styles.combatantRow, align === 'flex-end' && styles.reverseRow]}>
        {active ? (
          <PokemonSprite
            species={active.speciesForme}
            side={spriteSide}
            gen={gen}
            fainted={active.fainted}
          />
        ) : (
          <View style={styles.spritePlaceholder} />
        )}

        <View style={styles.nameplate}>
          <Text style={styles.trainerName} numberOfLines={1}>
            {side.name || label}
          </Text>
          {active ? (
            <>
              <View style={styles.nameRow}>
                <Text style={styles.speciesName} numberOfLines={1}>
                  {active.speciesForme}
                </Text>
                {active.status && (
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: STATUS_COLORS[active.status] ?? theme.color.textMuted },
                    ]}
                  >
                    <Text style={styles.statusText}>{active.status.toUpperCase()}</Text>
                  </View>
                )}
              </View>
              <HpBar hp={active.hp} maxhp={active.maxhp} fainted={active.fainted} />
            </>
          ) : (
            <Text style={styles.speciesName}>—</Text>
          )}
          <TeamDots side={side} />
        </View>
      </View>
    </View>
  );
}

function PokemonSprite({
  species,
  side,
  gen,
  fainted,
}: {
  species: string;
  side: 'p1' | 'p2';
  gen: number | undefined;
  fainted: boolean;
}) {
  const sprite = getBattleSprite(species, side, gen ? { gen: gen as 1 } : {});
  // Sprites are authored at native resolution; cap the height so a tall
  // Pokémon doesn't crowd the log out of a phone screen.
  const scale = Math.min(1.4, 96 / sprite.height);
  return (
    <Image
      source={{ uri: sprite.url }}
      style={{
        width: sprite.width * scale,
        height: sprite.height * scale,
        opacity: fainted ? 0.25 : 1,
      }}
      resizeMode="contain"
    />
  );
}

function HpBar({ hp, maxhp, fainted }: { hp: number; maxhp: number; fainted: boolean }) {
  const fraction = maxhp > 0 ? Math.max(0, hp / maxhp) : 0;
  const percent = Math.round(fraction * 1000) / 10;
  return (
    <View>
      <View style={styles.hpTrack}>
        <View
          style={[
            styles.hpFill,
            { width: `${fraction * 100}%`, backgroundColor: hpColor(fraction) },
          ]}
        />
      </View>
      <Text style={styles.hpText}>{fainted ? 'fainted' : `${percent}%`}</Text>
    </View>
  );
}

/** One dot per team member, dimmed when fainted — the at-a-glance score. */
function TeamDots({ side }: { side: Side }) {
  if (!side.team.length) return null;
  return (
    <View style={styles.teamDots}>
      {side.team.map((mon, i) => (
        <View
          key={`${mon.speciesForme}-${i}`}
          style={[styles.teamDot, mon.fainted && styles.teamDotFainted]}
        />
      ))}
    </View>
  );
}

function BattleLog({ log }: { log: BattleHandle['log'] }) {
  const listRef = useRef<FlatList<BattleHandle['log'][number]>>(null);
  useEffect(() => {
    if (log.length) listRef.current?.scrollToEnd({ animated: true });
  }, [log.length]);

  return (
    <FlatList
      ref={listRef}
      style={styles.log}
      contentContainerStyle={styles.logContent}
      data={log}
      keyExtractor={item => String(item.id)}
      renderItem={({ item }) => <LogLine text={item.text} />}
      ListEmptyComponent={<Text style={styles.logMuted}>Battle starting…</Text>}
      onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
    />
  );
}

/**
 * Renders one log line, turning Showdown's `**bold**` markup into actual
 * bold text instead of showing the asterisks literally.
 */
function LogLine({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const isTurnMarker = /^==.*==$/.test(trimmed);
  const parts = trimmed.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);

  return (
    <Text style={[styles.logLine, isTurnMarker && styles.logTurn]}>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <Text key={i} style={styles.logBold}>
            {part.slice(2, -2)}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
    </Text>
  );
}

function ChoicePanel({ handle }: { handle: BattleHandle }) {
  const { battle, request, chooseMove, chooseSwitch, chooseTeamOrder } = handle;
  const [teraActive, setTeraActive] = useState(false);
  const [teamOrder, setTeamOrder] = useState<number[]>([]);
  const [sent, setSent] = useState(false);

  // A fresh request means the server wants a new decision: re-enable the
  // controls that were locked after the last one was sent.
  const rqid = request && 'rqid' in request ? request.rqid : undefined;
  useEffect(() => {
    setSent(false);
    setTeraActive(false);
  }, [rqid]);

  if (!request || request.requestType === 'wait') {
    return (
      <View style={styles.controls}>
        <Text style={styles.waiting}>
          {battle.turn > 0 ? 'Waiting for the opponent…' : 'Waiting for the battle to start…'}
        </Text>
      </View>
    );
  }

  if (sent) {
    return (
      <View style={styles.controls}>
        <Text style={styles.waiting}>Choice sent — waiting for the opponent…</Text>
      </View>
    );
  }

  if (request.requestType === 'team') {
    const teamSize = request.side.pokemon.length;
    const toggle = (slot: number) => {
      const next = teamOrder.includes(slot)
        ? teamOrder.filter(s => s !== slot)
        : [...teamOrder, slot];
      setTeamOrder(next);
      if (next.length === teamSize) {
        chooseTeamOrder(next);
        setTeamOrder([]);
        setSent(true);
      }
    };
    return (
      <View style={styles.controls}>
        <Text style={styles.sectionLabel}>
          Team preview — tap in lead order ({teamOrder.length}/{teamSize})
        </Text>
        <View style={styles.buttonWrap}>
          {request.side.pokemon.map((mon, i) => {
            const slot = i + 1;
            const order = teamOrder.indexOf(slot);
            const species = mon.details.split(',')[0]!;
            return (
              <TouchableOpacity
                key={mon.ident}
                style={[styles.switchButton, order >= 0 && styles.switchButtonPicked]}
                onPress={() => toggle(slot)}
              >
                <PokemonIcon species={species} />
                <Text style={styles.switchName} numberOfLines={1}>
                  {order >= 0 ? `${order + 1}. ` : ''}
                  {species}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  const active = request.requestType === 'move' ? request.active[0] : null;
  const forceSwitch = request.requestType === 'switch' ? request.forceSwitch[0] : false;
  const canMove = !!active && !forceSwitch;
  const canSwitch = forceSwitch || active?.trapped !== true;
  const gen = battle.gen?.num;

  return (
    <View style={styles.controls}>
      {canMove && active && (
        <>
          <View style={styles.buttonWrap}>
            {active.moves.map((move, i) => {
              const disabled = 'disabled' in move && move.disabled;
              const type = getMoveType(move.name, gen as 9 | undefined);
              const color = type ? TYPE_COLORS[type] : theme.color.accent;
              const pp = 'pp' in move ? `${move.pp}/${move.maxpp}` : null;
              return (
                <TouchableOpacity
                  key={`${move.id}-${i}`}
                  style={[
                    styles.moveButton,
                    { backgroundColor: color },
                    disabled && styles.moveButtonDisabled,
                  ]}
                  disabled={!!disabled}
                  onPress={() => {
                    chooseMove(i + 1, teraActive ? { terastallize: true } : undefined);
                    setSent(true);
                  }}
                >
                  <Text style={styles.moveName} numberOfLines={1}>
                    {move.name}
                  </Text>
                  <View style={styles.moveMeta}>
                    {type && <Text style={styles.moveType}>{type}</Text>}
                    {pp && <Text style={styles.movePp}>{pp}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {active.canTerastallize && (
            <TouchableOpacity
              style={[styles.teraButton, teraActive && styles.teraButtonActive]}
              onPress={() => setTeraActive(t => !t)}
            >
              <Text style={[styles.teraText, teraActive && styles.teraTextActive]}>
                {teraActive ? '✓ ' : ''}
                Terastallize · {active.canTerastallize}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {canSwitch && (
        <>
          <Text style={styles.sectionLabel}>{forceSwitch ? 'Choose a replacement' : 'Switch'}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.switchRow}>
              {request.side.pokemon.map((mon, i) => {
                const fainted = mon.condition.startsWith('0');
                if (mon.active || fainted) return null;
                const species = mon.details.split(',')[0]!;
                return (
                  <TouchableOpacity
                    key={mon.ident}
                    style={styles.switchButton}
                    onPress={() => {
                      chooseSwitch(i + 1);
                      setSent(true);
                    }}
                  >
                    <PokemonIcon species={species} />
                    <Text style={styles.switchName} numberOfLines={1}>
                      {species}
                    </Text>
                    <Text style={styles.switchHp}>{mon.condition}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.space(2),
  },
  tier: { color: theme.color.text, fontWeight: '700', fontSize: 15, flexShrink: 1 },
  turnPill: {
    backgroundColor: theme.color.surfaceRaised,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1),
  },
  turnText: { color: theme.color.textMuted, fontSize: 12, fontWeight: '600' },

  field: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space(3),
    gap: theme.space(2),
  },
  combatant: { width: '100%' },
  combatantRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(3), width: '100%' },
  reverseRow: { flexDirection: 'row-reverse' },
  spritePlaceholder: { width: 72, height: 72 },
  nameplate: { flex: 1, gap: 2 },
  trainerName: { color: theme.color.textMuted, fontSize: 11 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2) },
  speciesName: { color: theme.color.text, fontWeight: '700', fontSize: 15 },
  statusBadge: {
    paddingHorizontal: theme.space(1.5),
    paddingVertical: 1,
    borderRadius: theme.radius.sm,
  },
  statusText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  hpTrack: {
    height: 7,
    backgroundColor: theme.color.bg,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    marginTop: 3,
  },
  hpFill: { height: '100%', borderRadius: theme.radius.pill },
  hpText: { color: theme.color.textMuted, fontSize: 10, marginTop: 2 },
  teamDots: { flexDirection: 'row', gap: 3, marginTop: 4 },
  teamDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.color.accent,
  },
  teamDotFainted: { backgroundColor: theme.color.border },

  log: { flex: 1, marginTop: theme.space(2) },
  logContent: { paddingVertical: theme.space(2) },
  logLine: { color: theme.color.text, fontSize: 13, lineHeight: 19, paddingVertical: 1 },
  logBold: { fontWeight: '700' },
  logTurn: {
    color: theme.color.textMuted,
    fontWeight: '700',
    marginTop: theme.space(2),
    fontSize: 12,
  },
  logMuted: { color: theme.color.textMuted, fontStyle: 'italic' },

  controls: {
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    paddingTop: theme.space(3),
    paddingBottom: theme.space(2),
    gap: theme.space(2),
  },
  sectionLabel: { color: theme.color.textMuted, fontSize: 11, fontWeight: '600' },
  waiting: { color: theme.color.textMuted, textAlign: 'center', paddingVertical: theme.space(3) },
  buttonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(2) },

  moveButton: {
    flexGrow: 1,
    flexBasis: '47%',
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2.5),
  },
  moveButtonDisabled: { opacity: 0.35 },
  moveName: { color: '#fff', fontWeight: '700', fontSize: 14 },
  moveMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  moveType: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '600' },
  movePp: { color: 'rgba(255,255,255,0.85)', fontSize: 10 },

  teraButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.color.tera,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(1.5),
  },
  teraButtonActive: { backgroundColor: theme.color.tera },
  teraText: { color: theme.color.tera, fontWeight: '700', fontSize: 12 },
  teraTextActive: { color: '#fff' },

  switchRow: { flexDirection: 'row', gap: theme.space(2) },
  switchButton: {
    alignItems: 'center',
    backgroundColor: theme.color.surfaceRaised,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(2),
    paddingVertical: theme.space(2),
    width: 84,
  },
  switchButtonPicked: { backgroundColor: theme.color.accent },
  switchName: { color: theme.color.text, fontSize: 10, fontWeight: '600' },
  switchHp: { color: theme.color.textMuted, fontSize: 9 },
});
