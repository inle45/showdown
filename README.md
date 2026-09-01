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
apps/mobile       Expo / React Native app: a single chat screen that proves
                   the core layer end-to-end (connect, guest auth, join,
                   send/receive) and keeps the socket in step with AppState.
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
  production-mode Metro bundle compiled to Hermes bytecode (~590 modules,
  ~1.8MB `.hbc`). This is what caught the `.js`-extension resolution bug and
  the `hermesc`/class-fields bug above; a passing typecheck alone caught
  neither.
- ✅ **Confirmed on a real device, against the live server.** Running in Expo
  Go on Android via `npx expo start`: connects, authenticates as a guest,
  joins `#lobby`, and receives real live chat over the actual `sim3.psim.us`
  socket. This is the first evidence that `ShowdownConnection`,
  `ShowdownClient`, `useShowdownClient`, and the Metro/Hermes build all work
  together outside a mock — everything above this line was necessary but not
  sufficient on its own.
- ❌ **`AppState` background/foreground transitions not yet exercised on
  device.** `suspend()`/`resume()` are unit-tested against a mock connection
  (see `connection.test.ts`), and the app wires them to `AppState`, but
  nobody has actually backgrounded the app on a phone and confirmed the
  socket suspends and cleanly reconnects on return. This is the next thing
  to actually try.
- ❌ **No password-authenticated login tried yet** — only the guest path
  above. `resolveLoginCommand`'s registered-account branch is unit-tested
  against a mocked login server, not the real one.

The connection layer works end to end against the real world. What's still
unverified is specifically the mobile-native behavior this app exists to
prove — backgrounding — and real-account login.

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
- **Not verified on a device or against a real server** — see Verification
  above.
- Outbound frames are not queued while offline, by design: a queue would replay
  stale chat after an outage and silently replay connection-scoped auth commands.
  `send()` returns `false` instead, so the UI can decide.
