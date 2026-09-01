module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          // Left unset, babel-preset-expo defaults this to 'hermes-stable' for
          // the Hermes engine, which leaves modern class syntax (native class
          // fields in particular) untranspiled on the assumption that Hermes
          // parses it natively. On SDK 54 / react-native 0.81.5's bundled
          // hermesc, it does not: hermesc fails with "invalid statement
          // encountered" on plain class field declarations (a known issue for
          // this exact SDK/RN pairing, e.g. expo/expo#46064). Forcing the
          // 'default' profile makes Babel transpile classes down to the
          // ES5-compatible constructor-function form instead, which hermesc
          // has always handled. Revisit this once upstream ships a hermesc fix
          // for this SDK line.
          unstable_transformProfile: 'default',
        },
      ],
    ],
  };
};
