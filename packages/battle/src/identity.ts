import { toID } from '@pkmn/data';

/**
 * Whether two Showdown usernames refer to the same account.
 *
 * Raw username strings from the protocol are not directly comparable across
 * contexts: `|updateuser|` prefixes an unranked name with a leading space (the
 * placeholder for the rank-symbol slot other users have, e.g. `+`/`%`/`@`),
 * while `|player|` sends the bare name with no such prefix — confirmed by
 * connecting live and comparing byte for byte: `|updateuser|` gave
 * `" Guest 38980330"`, the same account's `|player|p2|` line gave
 * `"Guest 38980330"`. A raw `===` between "my logged-in username" and "this
 * side's name" therefore fails for every guest account, silently — the
 * failure is invisible whenever the guest happens to land on the side a
 * caller defaulted to anyway, and wrong exactly when they don't.
 *
 * `toID()` is the normalization Showdown's own ecosystem uses for this
 * exact problem (`@pkmn/client`'s `Side.id` is already computed this way) —
 * lowercases and strips everything but `[a-z0-9]`, so rank prefixes,
 * leading spaces, and casing differences all wash out.
 */
export function isSameUser(a: string, b: string): boolean {
  return toID(a) === toID(b);
}
