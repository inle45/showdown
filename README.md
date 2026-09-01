# showdown-mobile

An unofficial Pokémon Showdown mobile client.

> Not affiliated with Smogon or Pokémon Showdown. Pokémon is a trademark of
> Nintendo / Creatures Inc. / GAME FREAK Inc.

## Why this exists

Showdown's web client already runs in a mobile browser, so re-creating it is not
the point. The things a browser tab *cannot* do are:

- **Push notifications** — challenge received, PM, your turn, timer running down.
- **Surviving the network** — WiFi↔cellular handoff, and returning from the
  background without losing the battle.
- **A teambuilder built for touch** — the acknowledged weak spot of the web
  client on a phone.

Those are the reasons to ship an app, and they are why the connection layer was
built first.

## Architecture

```
packages/core     Platform-agnostic session layer. No React, no Node builtins.
packages/battle   Battle state derived from the protocol, via @pkmn/client.
                   Regression-tested against 30 real replays across five
                   formats/generations — see "De-risking battles" below.
                   Also has the live-battle wiring (LiveBattle, choice
                   builders) the app's battle screen is built on.
apps/mobile       Expo / React Native app: lobby chat (proves the core
                   session layer end-to-end) and a live battle screen
                   (proves packages/battle actually plays, not just
                   replays) — see "The battle screen" below. Keeps the
                   socket in step with AppState throughout.
```

### Don't rewrite what `@pkmn` already maintains

The [`@pkmn`](https://github.com/pkmn/ps) packages are MIT-licensed, actively
maintained, and extracted from Showdown's own code:

| Package | Replaces |
| --- | --- |
| `@pkmn/protocol` | Hand-written protocol parsing (it is exhaustively typed) |
| `@pkmn/client` | The battle state machine |
| `@pkmn/dex` / `@pkmn/data` | Pokédex, moves, learnsets, formats |
| `@pkmn/login` | The `challstr` → assertion → `/trn` handshake |
| `@pkmn/sets` | Smogon-format team import/export |

Every prior open-source Android client reimplemented this by hand, and every one
of them stalled on battles. Verified before committing to the stack: the whole
`@pkmn` tree pulls **8 packages, uses zero Node builtins, and is network-layer
agnostic** — so it runs unmodified on Hermes with React Native's `fetch`.

The practical consequence is that the remaining work on battles is *rendering*,
not simulation.

### De-risking battles before building on top of them

Every prior client got chat working and stalled on battles. Rather than find
that out after building a battle screen on top of `@pkmn/client`,
`packages/battle` checks the foundation first: `npm run fetch-fixtures` pulls
a small, real corpus from Showdown's public replay API — 30 replays spanning
singles, doubles, random battles, the current generation, and Gen 1 — and
`replayLog()` feeds each one through a fresh `Battle` line by line. The test
suite asserts every fixture reaches a clean `|win|`/`|tie|` without an
exception, and that the winner the server announced is actually one of the
two players `Battle` tracked.

That last check exists because `Battle.add` turned out to be deliberately
tolerant: it doesn't throw on a message it doesn't recognize, degrading to
placeholder data instead of crashing (verified by hand — feeding it a
garbage `|move|` line with a nonexistent move and nonexistent Pokémon
produced no error at all). Good behavior for a client staying alive against
protocol messages it doesn't know about yet, but it means "no exception" is
a weaker signal than it first looks: this corpus catches crashes and
misidentified outcomes, not a subtly wrong HP value or status. A value-level
oracle — asserting exact per-turn state against a known-correct source —
would catch more; it's a separate, larger effort than this test claims to
be.

### The battle screen

`useBattle` + `BattleScreen` (`apps/mobile/src`) turn `packages/battle`'s
state tracking into something you can actually play. A battle room needs no
`/join` — the server starts routing to it the moment a match exists — so
`useShowdownClient` just watches for the room's `|init|battle` and the app
switches views.

Two things this is built on rather than hand-rolled, both from `@pkmn/view`:

- **`LogFormatter`** renders human-readable battle text ("Gyarados used
  Waterfall!"), instead of a hand-written translator for the protocol's
  several hundred message types.
- **`ChoiceBuilder`** turns a tap ("move 1", "switch 3") into the exact
  command string the server accepts, and already gets a detail right that
  Showdown's *own* protocol docs get wrong: `SIM-PROTOCOL.md` documents the
  Terastallize modifier as `terastalize` (one L); the live server's actual
  `/choose` parser (`sim/side.ts`, checked directly) only accepts `terastal`
  or `terastallize` (two Ls). `@pkmn/view` emits the two-L form; a
  hand-rolled version copying the docs would have shipped a button that
  silently failed server-side. `choice.test.ts` pins this against ever
  regressing to the documented-but-non-functional spelling.

Scope for this pass is deliberately singles-only: doubles/triples need
per-slot targeting and multiple simultaneous choices, team preview is
tap-to-append rather than drag-to-reorder, and there are no sprites or move
animations — see Known gaps.

### Why reconnect is architectural, not a later patch

A Showdown session is bound to its socket:

- `challstr` is issued **per connection** and is single-use. There is no session
  resume, so every reconnect needs a full login round-trip.
- The server does not remember a dropped client's rooms, and replays nothing it
  missed. Rooms must be re-joined explicitly.

So callers declare *intent* (`join`/`leave`) and `ShowdownClient` keeps the
server in sync with that intent across arbitrarily many reconnects. Retrofitting
this onto a client that assumed one stable connection is painful, which is why
it is the foundation rather than a feature.

The layering keeps this testable:

- `ShowdownConnection` — socket lifecycle, backoff, liveness. Knows nothing about
  the protocol, so reconnect behaviour is tested without a server or a login.
- `ShowdownClient` — authentication, room membership, protocol dispatch.

Both take injectable `WebSocket` and `fetch` implementations, which is what lets
the suite drive a network blip by hand instead of hitting the live server.

### The mobile app's job right now

`apps/mobile` is one screen: connect, join the lobby as a guest, send and
receive chat. Its purpose is not chat — it's proving the pieces above actually
work together under React Native, not just under Vitest:

- `useShowdownClient` (`apps/mobile/src/useShowdownClient.ts`) owns the one
  `ShowdownClient` instance and wires `AppState` to it — `suspend()` on
  `'background'`, `resume()` on `'active'`. `'inactive'` (a transient state,
  e.g. an iOS system dialog) is deliberately left alone: suspending on it would
  drop the connection during normal interaction, not just backgrounding.
- `metro.config.js` adds `watchFolders`/`nodeModulesPaths` for the workspace
  root, because `packages/core` lives outside `apps/mobile` and Metro only
  watches its own project directory by default.

Building this surfaced a real bug that `tsc --noEmit` alone did not catch:
`packages/core`'s relative imports used explicit `.js` specifiers (the
standard TS convention under `moduleResolution: "Bundler"`, which `tsc` and
Vitest's esbuild both remap to the sibling `.ts` file). Metro's resolver does
not do that remapping — it looks for a literal `client.js` and fails. Fixed by
switching to extensionless specifiers, which all three resolvers (`tsc`,
Vitest, Metro) handle natively. This is the reason `expo export -p android`
(an actual Hermes bytecode bundle, not just a type check) is treated as the
real verification step for this package — see Verification below.

### Pinned to Expo SDK 54, not the latest SDK

The app targets SDK 54, one behind the SDK the tooling scaffolds by default,
because the **Play Store build of Expo Go is currently stuck on SDK 54** —
Expo's changelog cites App Store approval delays holding back the store
release, and each Expo Go build supports exactly one SDK, with no
backward compatibility. A project on a newer SDK just fails to open in
Expo Go from the Play Store with "Project is incompatible with this version
of Expo Go," regardless of how current that install actually is. The
alternative was sideloading a matching Expo Go APK from expo.dev/go outside
the Play Store, re-done on every future SDK bump; pinning to 54 keeps the
zero-friction path of installing Expo Go from the Play Store and scanning a
QR code. Revisit this once the Play Store build catches up.

Downgrading an SDK version is not just editing one line: `expo`,
`react-native`, `react`, `@types/react`, and `typescript` all have to move
together to versions the SDK actually pairs with, and those pairings aren't
guessable — get one wrong and you get confusing runtime errors rather than a
clean failure. `npx expo install expo@54 && npx expo install --fix` (see
[Expo's SDK walkthrough](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/))
does this correctly by reading it from Expo's own compatibility data rather
than guessing.

That downgrade surfaced two more real bugs, both only visible in an actual
bundle, not in `tsc --noEmit`:

1. **Stale hoisted `babel-preset-expo`.** Running `expo install` commands
   incrementally on top of an already-`npm install`ed SDK-57 tree left a
   `babel-preset-expo@57.0.9` hoisted at the workspace root, shadowing the
   correct `54.0.12` copy nested under `expo`'s own `node_modules`. Node's
   module resolution silently preferred the stale hoisted one. The preset
   version transforms code differently depending on the target SDK, so the
   app was being compiled for SDK 57 while everything else in the tree had
   moved to 54. Fixed with a clean reinstall (`rm -rf node_modules
   package-lock.json` at the workspace root, then `npm install`) rather than
   trying to patch an incrementally-mutated dependency tree — the standard
   fix for hoisting corruption after a mid-tree version change.

2. **`hermesc` (react-native 0.81.5's bundled Hermes compiler, which SDK 54
   pins) rejects plain class field declarations** (`private attempt = 0;` —
   standard, non-private ES2022 class fields) with "invalid statement
   encountered." `babel-preset-expo` defaults to
   `unstable_transformProfile: 'hermes-stable'` for the Hermes engine, which
   deliberately leaves modern class syntax untranspiled on the assumption
   that Hermes parses it natively — an assumption this SDK 54 / RN 0.81.5
   hermesc build doesn't hold up on, and a documented, recurring class of
   bug for this exact SDK/RN pairing (e.g.
   [expo/expo#46064](https://github.com/expo/expo/issues/46064)). Worked
   around by pinning `unstable_transformProfile: 'default'` in
   `apps/mobile/babel.config.js`, which forces Babel to transpile classes to
   the ES5-compatible constructor-function form regardless of engine —
   costs a little bundle size and runtime perf, buys a build that actually
   compiles. Revisit once upstream ships a hermesc fix for this SDK line.

### Wiring the battle screen surfaced one more real bug, and one real cost

`ShowdownClient`'s `ParsedMessage.args`/`kwArgs` were originally typed as the
loose `readonly string[]` / `Record<string, unknown>` — a deliberate
simplification made before anything needed more. Once `useBattle` tried to
hand a live message straight to `LiveBattle.feed()` (which forwards it to
`Battle.add()` and `LogFormatter.formatText()`, both of which require
`@pkmn/protocol`'s real discriminated `ArgType`/`KWArgType`), that widening
became a real type error rather than a convenience. Fixed at the root —
tightened `ParsedMessage` to the precise types instead of casting around the
mismatch in the app — since the values were always actually that type
(`@pkmn/protocol` is already a `packages/core` dependency) and every existing
consumer's `args[0] === 'chat'`-style narrowing still typechecks correctly
against the precise union.

Separately, not a bug: once `packages/battle` (and its `@pkmn/dex` data)
entered the bundle graph, a cold `expo export -p android` went from
single-digit seconds to **~17.5 minutes** — `@pkmn/dex` embeds every
generation's full species/move/item data, and `hermesc`'s native compile of
that in one bundle is genuinely CPU-bound work, not a hang (confirmed by
watching worker processes at 80-100%+ CPU throughout). `npx expo start`'s
first cold bundle will be slow for the same reason; Metro's cache makes
subsequent incremental rebuilds fast again. Worth knowing before assuming a
long silent `expo export`/`expo start` first run is stuck.

## Usage

```ts
import { ShowdownClient } from '@showdown-mobile/core';

const client = new ShowdownClient({
  credentials: { username: 'yourname', password: 'yourpassword' },
});

client.on('ready', ({ username }) => console.log('logged in as', username));
client.on('pm', ({ from, message }) => console.log(`${from}: ${message}`));
client.on('authError', error => console.error(error.message));

client.connect();
client.join('lobby'); // joined now, and re-joined after every reconnect

// Wire these to React Native's AppState:
client.suspend(); // backgrounded
client.resume();  // foregrounded — reconnects immediately, no backoff wait
```

Omit `credentials` to browse as a guest; no login request is made.

## Getting the app on a phone

**You do not need a local toolchain, an emulator, or Termux.** Every push
builds an installable APK in CI:

1. Open the repo's **Actions** tab on GitHub (works fine in a phone browser).
2. Pick the most recent **Build Android APK** run.
3. Download the `showdown-mobile-<sha>` artifact and install the APK inside.

It's a **debug** build on purpose: a release APK must be signed, and an
unsigned one won't install at all, whereas debug builds use Android's
universally-available debug keystore. Android will warn about installing it —
expected for a build that isn't store-signed. The workflow runs the full
typecheck and test suites first, so a red build never produces an APK.

The dev-server path (`npx expo start` + Expo Go) still works and is faster
for iterating; it's just no longer the only way in.

## Development

```sh
npm install
npm test        # 28 tests, no network access required
npm run typecheck

cd apps/mobile
npx expo start          # Metro dev server + QR code for Expo Go
npx expo start --android
```

**Do not point development or tests at `sim3.psim.us`.** Run a local Showdown
server instead: it keeps tests deterministic and avoids rate limits and IP bans.

## Verification

What has actually been checked, and what has not:

- ✅ `packages/core`: 28 Vitest tests (mocked WebSocket/fetch, no network),
  `tsc --noEmit`.
- ✅ `apps/mobile`: `tsc --noEmit`, and `npx expo export -p android` — a real
  production-mode Metro bundle compiled to Hermes bytecode. Caught, in order:
  the `.js`-extension resolution bug, the `hermesc`/class-fields bug, and (once
  the battle screen was wired in) a real type error from `ParsedMessage`
  being too loosely typed — three real bugs a passing typecheck alone caught
  none of. Currently 608 modules, ~6.25MB `.hbc` (up from ~590 modules,
  ~1.8MB before `packages/battle`/`@pkmn/dex` entered the graph — see "one
  more real bug, and one real cost" above for what that did to bundle time).
- ✅ **Confirmed on a real device, against the live server.** Running in Expo
  Go on Android via `npx expo start`: connects, authenticates as a guest,
  joins `#lobby`, and receives real live chat over the actual `sim3.psim.us`
  socket. This is the first evidence that `ShowdownConnection`,
  `ShowdownClient`, `useShowdownClient`, and the Metro/Hermes build all work
  together outside a mock — everything above this line was necessary but not
  sufficient on its own.
- ✅ **`AppState` background/foreground transitions confirmed on device.**
  Backgrounded the app for 10-15s and returned: the connection badge cycled
  through `reconnecting` back to online and the lobby kept working, with no
  restart needed. This was the specific mobile-native behavior this app
  exists to prove, and it's now been seen working on real hardware, not just
  asserted against a mock in `connection.test.ts`.
- ✅ **`packages/battle`: 36 Vitest tests** — 31 replaying 30 real fixtures
  across 5 formats/generations through `@pkmn/client` (see "De-risking
  battles" above for exactly what this does and doesn't prove), plus 5
  covering the choice-building layer (`chooseMove`/`chooseSwitch`/
  `chooseTeamOrder`) against a hand-built request fixture — including the
  Terastallize-spelling regression test described in "The battle screen"
  above.
- ❌ **The battle screen has not been used in a real battle.** It compiles
  and bundles (see above), and its building blocks are tested in isolation —
  the replay corpus for state tracking, the choice builders for command
  strings — but nothing has driven an actual live match: no `|request|` has
  been received from the real server, no move or switch choice has actually
  been tapped and sent, and the UI has never been visually confirmed to
  render correctly. This environment has no device to battle from and no way
  to orchestrate two live accounts into a match. The next real signal is
  someone opening a real battle on a device and playing at least one turn.
- ❌ **No password-authenticated login tried yet** — only the guest path
  above. `resolveLoginCommand`'s registered-account branch is unit-tested
  against a mocked login server, not the real one.

The connection layer and the battle *state* machine both now have real-world
evidence behind them, not just mocks. The battle *screen* does not yet —
"compiles and the pieces are unit-tested" is a materially weaker claim than
"has been played," and should be read as exactly that until someone actually
plays a turn on it.

## Known gaps

- **`idleTimeout` is disabled by default.** Mobile networks drop sockets without
  sending a FIN, so a dead socket can look `open` forever, and a watchdog is the
  only reliable detection. The mechanism is implemented and tested, but the right
  value depends on how often the server emits unsolicited traffic — which has not
  been measured against the live server. Too tight a value causes reconnect
  loops, so it ships off until measured.
- **Licensing needs confirming before distribution.** `@pkmn` is MIT, but
  Showdown's own client is **AGPLv3**; anything borrowed from it directly would
  make this app AGPLv3 too. Distribution also has to account for Pokémon IP and
  fan-made sprites — existing unofficial clients are generally distributed
  outside the Play Store.
- **Account login not verified against the real server** — see Verification
  above.
- **The battle screen has never been used in a real battle** — see
  Verification above. Treat it as unproven until someone actually plays a
  turn on a device.
- **Battle screen is singles-only.** No doubles/triples target selection, no
  Mega Evolution / Z-Move / Dynamax buttons (Terastallize is the only
  modifier exposed), team preview is tap-to-append rather than
  drag-to-reorder, and there are no sprites or move animations — just text,
  an HP bar, and a status badge.
- **No in-app way to start a battle.** Challenging someone or searching the
  ladder isn't built; the battle screen only activates once a match already
  exists (found via another client, or a `/challenge` typed into lobby
  chat).
- **Cold bundles are slow** (~17.5 minutes as of `packages/battle`'s
  `@pkmn/dex` dependency) — see "one more real bug, and one real cost"
  above. Not a hang; don't assume a long-silent `expo start`/`expo export`
  first run needs killing.
- Outbound frames are not queued while offline, by design: a queue would replay
  stale chat after an outage and silently replay connection-scoped auth commands.
  `send()` returns `false` instead, so the UI can decide.
