import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';

/**
 * Parsing every generation's species/moves/abilities/items data is the
 * expensive part of standing up a `Battle`. Shared across every battle in
 * this process so replaying hundreds of logs doesn't redo it each time.
 */
export const gens = new Generations(Dex);
