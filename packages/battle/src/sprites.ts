import type { GenerationNum, TypeName } from '@pkmn/types';
import { Icons, Sprites } from '@pkmn/img';

import { gens } from './generations';

export interface SpriteInfo {
  url: string;
  width: number;
  height: number;
  /** True for old-gen pixel art that must not be smoothed when scaled. */
  pixelated: boolean;
}

export interface IconInfo {
  /** The shared icon sheet every Pokémon icon is cropped out of. */
  sheetUrl: string;
  /** Pixel offsets into the sheet — negative, as CSS background-position. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Full sheet dimensions, needed to size the <Image> that gets cropped. */
export const ICON_SHEET_WIDTH = 480;
export const ICON_SHEET_HEIGHT = 5100;

/**
 * The animated battle sprite for a Pokémon, from the perspective of `side`.
 *
 * `p1` gets the back sprite (the player's own side faces away), `p2` the
 * front — matching how the official client stages a battle. Only those two
 * values exist here even in doubles: a battle is always staged as two facing
 * sides, with multiple sprites placed on each. These resolve to animated
 * GIFs on play.pokemonshowdown.com, which React Native's `Image` plays
 * natively on Android.
 */
export function getBattleSprite(
  speciesForme: string,
  side: 'p1' | 'p2',
  options: { gen?: GenerationNum; shiny?: boolean } = {},
): SpriteInfo {
  const sprite = Sprites.getPokemon(speciesForme, {
    side,
    gen: options.gen ?? 9,
    ...(options.shiny ? { shiny: true } : {}),
  });
  return {
    url: sprite.url,
    width: sprite.w,
    height: sprite.h,
    pixelated: sprite.pixelated,
  };
}

/**
 * Crop coordinates for a Pokémon's team icon within the shared icon sheet.
 *
 * `@pkmn/img` returns these as CSS `background-position` values, which have
 * no direct React Native equivalent — the app renders them by placing a
 * full-size sheet `Image` inside a clipped view at these offsets.
 */
export function getIcon(speciesForme: string): IconInfo {
  const icon = Icons.getPokemon(speciesForme);
  return {
    sheetUrl: icon.url,
    left: icon.left,
    top: icon.top,
    width: 40,
    height: 30,
  };
}

/**
 * A move's element type, for colouring its button.
 *
 * Returns undefined for a move the dex doesn't know (brand-new content the
 * installed `@pkmn/dex` predates), so callers fall back rather than crash.
 */
export function getMoveType(moveName: string, gen: GenerationNum = 9): TypeName | undefined {
  return gens.get(gen).moves.get(moveName)?.type;
}

/** Showdown's canonical type colours, for move buttons and type badges. */
export const TYPE_COLORS: Record<TypeName, string> = {
  Normal: '#9FA19F',
  Fighting: '#FF8000',
  Flying: '#81B9EF',
  Poison: '#9141CB',
  Ground: '#915121',
  Rock: '#AFA981',
  Bug: '#91A119',
  Ghost: '#704170',
  Steel: '#60A1B8',
  Fire: '#E62829',
  Water: '#2980EF',
  Grass: '#3FA129',
  Electric: '#FAC000',
  Psychic: '#EF4179',
  Ice: '#3DCEF3',
  Dragon: '#5060E1',
  Dark: '#624D4E',
  Fairy: '#EF70EF',
  Stellar: '#40B5A5',
  '???': '#68A090',
};
