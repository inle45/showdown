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
apps/mobile       Expo / React Native app.            (not started yet)
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
```

**Do not point development or tests at `sim3.psim.us`.** Run a local Showdown
server instead: it keeps tests deterministic and avoids rate limits and IP bans.

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
- `apps/mobile` does not exist yet.
- Outbound frames are not queued while offline, by design: a queue would replay
  stale chat after an outage and silently replay connection-scoped auth commands.
  `send()` returns `false` instead, so the UI can decide.
