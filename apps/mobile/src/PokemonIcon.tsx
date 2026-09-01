import { Image, View } from 'react-native';

import {
  ICON_SHEET_HEIGHT,
  ICON_SHEET_WIDTH,
  getIcon,
} from '@showdown-mobile/battle';

/**
 * A Pokémon's team icon, cropped out of Showdown's shared icon sheet.
 *
 * The sheet is one image holding every icon; `@pkmn/img` gives back the
 * offsets as CSS `background-position` values, which React Native has no
 * direct equivalent for. The equivalent here is a fixed-size view with
 * `overflow: 'hidden'` holding the full-size sheet shifted by those offsets —
 * one image download shared by every icon on screen, rather than a request
 * per Pokémon.
 */
export function PokemonIcon({ species, faded = false }: { species: string; faded?: boolean }) {
  const icon = getIcon(species);
  return (
    <View
      style={{
        width: icon.width,
        height: icon.height,
        overflow: 'hidden',
        opacity: faded ? 0.35 : 1,
      }}
    >
      <Image
        source={{ uri: icon.sheetUrl }}
        style={{
          width: ICON_SHEET_WIDTH,
          height: ICON_SHEET_HEIGHT,
          marginLeft: icon.left,
          marginTop: icon.top,
        }}
        resizeMode="stretch"
      />
    </View>
  );
}
