// ==================================================================================================
// CONSTANTS
// ==================================================================================================

export const CONFIG = {
  DB: {
    CACHE: { name: "LyricsCacheDB", version: 2, store: "lyrics" },
    TRANSLATIONS: { name: "TranslationsDB", version: 2, store: "translations" },
    LOCAL: { name: "LocalLyricsDB", version: 2, store: "localLyrics" }
  },

  CACHE_EXPIRY: {
    aggressive: 24 * 60 * 60 * 1000,
    moderate: 12 * 60 * 60 * 1000
  },

  KPOE_SERVERS: [
    "https://lyricsplus.atomix.one/", //meow's mirror
    "https://lyricsplus-seven.vercel.app", //jigen's mirror
    "https://lyricsplus.prjktla.workers.dev", //ibra's cf worker
    "http://ly.mxtiy.xyz/", //painfueg0's server (http only)
    "https://lyrics-plus-backend.vercel.app", //ibra's vercel
    "https://youlyplus.binimum.org" //binimum's server (spotify fetch didnt work)
  ],

  GEMINI: {
    MAX_RETRIES: 5,
    MIN_TEXT_SIMILARITY: 0.8
  },

  GOOGLE: {
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 500
  }
};

export const PROVIDERS = {
  KPOE: 'kpoe',
  CUSTOM_KPOE: 'customKpoe',
  LRCLIB: 'lrclib',
  LOCAL: 'local',
  GEMINI: 'gemini',
  GOOGLE: 'google',
  OPENROUTER: 'openrouter'
};

export const MESSAGE_TYPES = {
  FETCH_LYRICS: 'FETCH_LYRICS',
  RESET_CACHE: 'RESET_CACHE',
  GET_CACHED_SIZE: 'GET_CACHED_SIZE',
  TRANSLATE_LYRICS: 'TRANSLATE_LYRICS',
  FETCH_SPONSOR_SEGMENTS: 'FETCH_SPONSOR_SEGMENTS',
  UPLOAD_LOCAL_LYRICS: 'UPLOAD_LOCAL_LYRICS',
  GET_LOCAL_LYRICS_LIST: 'GET_LOCAL_LYRICS_LIST',
  DELETE_LOCAL_LYRICS: 'DELETE_LOCAL_LYRICS',
  FETCH_LOCAL_LYRICS: 'FETCH_LOCAL_LYRICS',
  FETCH_IMAGE: 'FETCH_IMAGE'
};
