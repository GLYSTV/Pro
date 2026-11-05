export interface SeedCategory {
  name: string;
  slug: string;
  icon: string;
  sortOrder: number;
}

export interface SeedChannel {
  name: string;
  category: string;
  streamUrl: string;
  logoUrl: string | null;
  country: string | null;
  language: string | null;
  description: string;
}

export const seedCategories: SeedCategory[] = [
  { name: "Noticias", slug: "noticias", icon: "Newspaper", sortOrder: 1 },
  { name: "Generalista", slug: "generalista", icon: "Tv", sortOrder: 2 },
  { name: "Deportes", slug: "deportes", icon: "Trophy", sortOrder: 3 },
  { name: "Infantil", slug: "infantil", icon: "Baby", sortOrder: 4 },
  { name: "Cine", slug: "cine", icon: "Clapperboard", sortOrder: 5 },
  { name: "Música", slug: "musica", icon: "Music", sortOrder: 6 },
  { name: "Documentales", slug: "documentales", icon: "Globe", sortOrder: 7 },
  { name: "Entretenimiento", slug: "entretenimiento", icon: "Sparkles", sortOrder: 8 },
  { name: "Institucional", slug: "institucional", icon: "Landmark", sortOrder: 9 },
  { name: "Pruebas", slug: "pruebas", icon: "FlaskConical", sortOrder: 10 },
];

/**
 * Canales de ejemplo. Todos son señales públicas y gratuitas emitidas por las
 * propias cadenas o por distribuidores FAST oficiales (CDNs de Akamai, CloudFront,
 * Otteravision, Wurl, etc.). Algunas pueden tener restricciones geográficas.
 */
export const seedChannels: SeedChannel[] = [
  // ───────── Noticias ─────────
  {
    name: "DW Español",
    category: "noticias",
    streamUrl: "https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8",
    logoUrl: "https://i.imgur.com/8MRNFb9.png",
    country: "DE",
    language: "es",
    description: "Señal internacional en español de Deutsche Welle: noticias, análisis y reportajes desde Europa.",
  },
  {
    name: "DW English",
    category: "noticias",
    streamUrl: "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8",
    logoUrl: "https://i.imgur.com/8MRNFb9.png",
    country: "DE",
    language: "en",
    description: "Deutsche Welle's 24-hour English news channel.",
  },
  {
    name: "France 24 Español",
    category: "noticias",
    streamUrl: "https://static.france24.com/live/F24_ES_LO_HLS/live_web.m3u8",
    logoUrl:
      "https://xstreamcp-assets-msp.streamready.in/assets/LIVETV/LIVECHANNEL/LIVETV_LIVETVCHANNEL_FRANCE_24/images/LOGO_HD/image.png",
    country: "FR",
    language: "es",
    description: "Noticias internacionales las 24 horas desde París, en español.",
  },
  {
    name: "France 24 English",
    category: "noticias",
    streamUrl: "https://static.france24.com/live/F24_EN_LO_HLS/live_web.m3u8",
    logoUrl:
      "https://xstreamcp-assets-msp.streamready.in/assets/LIVETV/LIVECHANNEL/LIVETV_LIVETVCHANNEL_FRANCE_24/images/LOGO_HD/image.png",
    country: "FR",
    language: "en",
    description: "International news 24/7 from Paris, in English.",
  },
  {
    name: "Canal Sur Noticias",
    category: "noticias",
    streamUrl: "https://cdnlive.codev8.net/rtvalive/smil:channel42.smil/playlist.m3u8",
    logoUrl: "https://i.imgur.com/A3JscwS.png",
    country: "ES",
    language: "es",
    description: "Canal de información continua de la Radio y Televisión de Andalucía.",
  },
  {
    name: "Canal 26",
    category: "noticias",
    streamUrl: "https://stream-gtlc.telecentro.net.ar/hls/canal26hls/main.m3u8",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Canal_26_logo_%282022%29.svg/500px-Canal_26_logo_%282022%29.svg.png",
    country: "AR",
    language: "es",
    description: "Canal de noticias argentino con cobertura las 24 horas.",
  },
  {
    name: "TRT World",
    category: "noticias",
    streamUrl: "https://tv-trtworld.medya.trt.com.tr/master.m3u8",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/TRT_World.svg/960px-TRT_World.svg.png",
    country: "TR",
    language: "en",
    description: "Turkish public broadcaster's international English-language news channel.",
  },
  {
    name: "CGTN",
    category: "noticias",
    streamUrl: "https://news.cgtn.com/resource/live/english/cgtn-news.m3u8",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/CGTN.svg/960px-CGTN.svg.png",
    country: "CN",
    language: "en",
    description: "China Global Television Network, English news channel.",
  },
  {
    name: "CBS News 24/7",
    category: "noticias",
    streamUrl:
      "https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f134e82a470f83d562deeca/master.m3u8",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/CBS_News_247_logo.svg/960px-CBS_News_247_logo.svg.png",
    country: "US",
    language: "en",
    description: "CBS News streaming network with breaking news and original reporting.",
  },
  {
    name: "Arirang TV",
    category: "noticias",
    streamUrl:
      "https://amdlive-ch01-ctnd-com.akamaized.net/arirang_1ch/smil:arirang_1ch.smil/playlist.m3u8",
    logoUrl: "https://i.imgur.com/Asu5pE9.png",
    country: "KR",
    language: "en",
    description: "Korea's international broadcaster: news, culture and entertainment.",
  },

  // ───────── Generalista ─────────
  {
    name: "Canal Sur Andalucía",
    category: "generalista",
    streamUrl:
      "https://dfk2a268yviz9.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-ddiii1m6jt6of/CanalSurAndaluciaES.m3u8",
    logoUrl: "https://i.imgur.com/lznnA4v.png",
    country: "ES",
    language: "es",
    description: "Señal internacional de Canal Sur, la televisión pública andaluza.",
  },
  {
    name: "Canal Sur 2",
    category: "generalista",
    streamUrl: "https://cdnlive.codev8.net/rtvalive/smil:channel22.smil/playlist.m3u8",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Canal_Sur_2_-_2017_logo.png/500px-Canal_Sur_2_-_2017_logo.png",
    country: "ES",
    language: "es",
    description: "Segundo canal de la RTVA con programación cultural y accesible.",
  },
  {
    name: "CMM TV",
    category: "generalista",
    streamUrl:
      "https://cdnapisec.kaltura.com/p/2288691/sp/228869100/playManifest/entryId/1_gnz6ity9/protocol/https/format/applehttp/flavorIds/1_a9gxgxzy,1_v71ryg4b,1_vbfvtjw6,1_obo1bqsx,1_3shk3s5d/a.m3u8",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/CMMedia.svg/960px-CMMedia.svg.png",
    country: "ES",
    language: "es",
    description: "Televisión pública de Castilla-La Mancha.",
  },
  {
    name: "Canal Once",
    category: "generalista",
    streamUrl: "https://vivo.canaloncelive.tv/securepkgr3/oncemexico/playlist.m3u8",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/2/2b/Canal_Once_logo_2025.png",
    country: "MX",
    language: "es",
    description: "Canal público mexicano del Instituto Politécnico Nacional: cultura, series y noticias.",
  },
  {
    name: "Azteca Internacional",
    category: "generalista",
    streamUrl: "https://azt-mun.otteravision.com/azt/mun/mun.m3u8",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/e/eb/Azteca_Internacional_logo_2023.png",
    country: "MX",
    language: "es",
    description: "Lo mejor de TV Azteca para el mundo: telenovelas, entretenimiento y noticias.",
  },
  {
    name: "Imagen TV",
    category: "generalista",
    streamUrl: "https://igd-it-runtime.otteravision.com/igd/it/it.m3u8",
    logoUrl: "https://i.imgur.com/lKrRvtS.png",
    country: "MX",
    language: "es",
    description: "Canal generalista mexicano con noticias, series y entretenimiento.",
  },

  // ───────── Infantil ─────────
  {
    name: "Clan",
    category: "infantil",
    streamUrl: "https://lge-lgla2.otteravision.com/lge/lgcla/lgcla.m3u8",
    logoUrl: "https://i.ibb.co/vv3FC2Nv/clan.png",
    country: "ES",
    language: "es",
    description: "El canal infantil de RTVE con series de animación y contenidos educativos.",
  },

  // ───────── Deportes ─────────
  {
    name: "Red Bull TV",
    category: "deportes",
    streamUrl: "https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8",
    logoUrl: "https://images.pluto.tv/channels/5e7cb84a172a0f0007da69e4/colorLogoPNG.png",
    country: "AT",
    language: "en",
    description: "Deportes extremos, música y aventuras en directo y bajo demanda.",
  },
  {
    name: "FIFA+ Hispanoamérica",
    category: "deportes",
    streamUrl:
      "https://6c849fb3.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/TEctbXhfRklGQVBsdXNTcGFuaXNoLTFfSExT/playlist.m3u8",
    logoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/FIFA%2B_(2025).svg/960px-FIFA%2B_(2025).svg.png",
    country: "CH",
    language: "es",
    description: "Partidos históricos, documentales y archivo oficial de la FIFA en español.",
  },

  // ───────── Documentales ─────────
  {
    name: "NASA TV",
    category: "documentales",
    streamUrl: "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8",
    logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/512px-NASA_logo.svg.png",
    country: "US",
    language: "en",
    description: "Misiones espaciales en directo, lanzamientos y documentales de la NASA.",
  },

  // ───────── Cine ─────────
  {
    name: "Cine Western",
    category: "cine",
    streamUrl:
      "https://d2nq34q0i1r3la.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-awohw8g217ho8/CineWestern_ES.m3u8",
    logoUrl: "https://i.imgur.com/2UROzSc.png",
    country: "ES",
    language: "es",
    description: "Clásicos del western las 24 horas, en castellano.",
  },
  {
    name: "Cine Friki",
    category: "cine",
    streamUrl:
      "https://d2mr4fu91mjx9m.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-rb0tx75ojbc5u/CineFriki_ES.m3u8",
    logoUrl: "https://i.imgur.com/b3Ospym.png",
    country: "ES",
    language: "es",
    description: "Ciencia ficción, terror y cine de culto para los más frikis.",
  },

  // ───────── Música ─────────
  {
    name: "Audiokiss TV",
    category: "musica",
    streamUrl: "https://master.tucableip.com/audiokisstv/index.m3u8",
    logoUrl:
      "https://www.audiokiss.com/audiokiss/wp-content/uploads/sites/4/2021/02/Audio_kiss800-768x405.png",
    country: "ES",
    language: "es",
    description: "Videoclips y éxitos musicales de todos los tiempos.",
  },

  // ───────── Entretenimiento ─────────
  {
    name: "Garage TV",
    category: "entretenimiento",
    streamUrl: "https://stream1.sersat.com/hls/garagetv.m3u8",
    logoUrl: "https://i.imgur.com/FqFxog1.png",
    country: "AR",
    language: "es",
    description: "Motor, tuning y cultura automovilística latinoamericana.",
  },

  // ───────── Institucional ─────────
  {
    name: "Canal Parlamento",
    category: "institucional",
    streamUrl: "https://congresodirecto.akamaized.net/hls/live/2037973/canalparlamento/master.m3u8",
    logoUrl: "https://i.imgur.com/BUO0wH6.png",
    country: "ES",
    language: "es",
    description: "Señal institucional del Congreso de los Diputados de España (emite durante sesiones).",
  },

  // ───────── Pruebas ─────────
  {
    name: "Big Buck Bunny (demo HLS)",
    category: "pruebas",
    streamUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    logoUrl: null,
    country: null,
    language: null,
    description: "Stream de prueba bajo demanda con múltiples calidades (cortesía de Mux).",
  },
  {
    name: "Tears of Steel (demo HLS)",
    category: "pruebas",
    streamUrl:
      "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
    logoUrl: null,
    country: null,
    language: null,
    description: "Cortometraje de la Blender Foundation servido por Unified Streaming.",
  },
  {
    name: "Mux Live Demo",
    category: "pruebas",
    streamUrl: "https://stream.mux.com/v69RSHhFelSm4701snP22dYz2jICy4E4FUyk02rW4gxRM.m3u8",
    logoUrl: null,
    country: null,
    language: null,
    description: "Stream de demostración de Mux Video.",
  },
];
