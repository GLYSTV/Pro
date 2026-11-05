import { and, asc, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";
import { db } from "@/db";
import { programs, type Program } from "@/db/schema";
import { createRng } from "@/lib/utils";

type Template = { title: string; genre: string; durations: number[]; description: string };

const TEMPLATES: Record<string, Template[]> = {
  noticias: [
    { title: "Informativo matinal", genre: "Noticias", durations: [60, 90, 120], description: "Toda la actualidad para empezar el día, con análisis y conexiones en directo." },
    { title: "Noticias en directo", genre: "Noticias", durations: [30, 60], description: "Resumen de la actualidad nacional e internacional." },
    { title: "Debate de actualidad", genre: "Debate", durations: [60], description: "Mesa de análisis con expertos sobre los temas del día." },
    { title: "Economía al día", genre: "Economía", durations: [30], description: "Mercados, empresas y claves económicas." },
    { title: "El tiempo", genre: "Meteorología", durations: [30], description: "Previsión meteorológica detallada." },
    { title: "Reportaje especial", genre: "Reportaje", durations: [30, 60], description: "Reportaje en profundidad sobre un tema de actualidad." },
    { title: "Entrevista", genre: "Entrevista", durations: [30], description: "Conversación con protagonistas de la actualidad." },
    { title: "Última hora", genre: "Noticias", durations: [30, 60], description: "Cobertura continua de las noticias de última hora." },
    { title: "Deportes", genre: "Deportes", durations: [30], description: "Lo más destacado del día en el mundo del deporte." },
    { title: "Noticias internacionales", genre: "Noticias", durations: [60], description: "La actualidad vista desde todos los continentes." },
  ],
  deportes: [
    { title: "Resumen de la jornada", genre: "Fútbol", durations: [60], description: "Los mejores goles y jugadas de la jornada." },
    { title: "Deportes extremos", genre: "Aventura", durations: [60, 90], description: "Surf, escalada, BMX y mucho más." },
    { title: "Motor: Grandes Premios", genre: "Motor", durations: [90, 120], description: "Carreras y análisis del mundo del motor." },
    { title: "Baloncesto en directo", genre: "Baloncesto", durations: [120], description: "Encuentro en directo con comentarios." },
    { title: "Magazine deportivo", genre: "Magazine", durations: [60], description: "Debate, entrevistas y actualidad deportiva." },
    { title: "Ciclismo: etapa del día", genre: "Ciclismo", durations: [120, 180], description: "Seguimiento completo de la etapa." },
    { title: "Partido histórico", genre: "Fútbol", durations: [120], description: "Revive un encuentro inolvidable." },
    { title: "Tenis: torneo internacional", genre: "Tenis", durations: [120], description: "Lo mejor del circuito profesional." },
  ],
  infantil: [
    { title: "Dibujos animados", genre: "Animación", durations: [30, 60], description: "Serie de animación para los más pequeños." },
    { title: "Aventuras en el bosque", genre: "Animación", durations: [30], description: "Un grupo de amigos vive aventuras en la naturaleza." },
    { title: "Aprende jugando", genre: "Educativo", durations: [30], description: "Juegos y retos para aprender divirtiéndose." },
    { title: "Serie juvenil", genre: "Serie", durations: [30, 60], description: "Historias de amistad y superación." },
    { title: "Cuentos antes de dormir", genre: "Cuentos", durations: [30], description: "Relatos clásicos narrados con ilustraciones." },
    { title: "Súper héroes", genre: "Animación", durations: [30], description: "Acción y valores con un equipo de héroes." },
    { title: "Canciones y bailes", genre: "Música", durations: [30], description: "Música para cantar y bailar en familia." },
  ],
  cine: [
    { title: "Película de la mañana", genre: "Cine", durations: [90, 120], description: "Largometraje para empezar el día." },
    { title: "Cine clásico", genre: "Cine", durations: [90, 120], description: "Grandes títulos de la historia del cine." },
    { title: "Sesión de tarde", genre: "Cine", durations: [90, 120], description: "Largometraje de tarde para toda la familia." },
    { title: "Cine de culto", genre: "Cine", durations: [90, 120], description: "Películas que marcaron una época." },
    { title: "Estreno de la noche", genre: "Cine", durations: [120], description: "El gran estreno de la noche." },
    { title: "Western al atardecer", genre: "Western", durations: [90, 120], description: "Duelos, forajidos y grandes paisajes." },
    { title: "Sesión golfa", genre: "Terror", durations: [90], description: "Terror y suspense para noctámbulos." },
    { title: "Ciencia ficción", genre: "Ciencia ficción", durations: [120], description: "Viajes al futuro y otros mundos." },
  ],
  musica: [
    { title: "Hits del momento", genre: "Pop", durations: [60], description: "Los videoclips más escuchados de la semana." },
    { title: "Clásicos de los 80", genre: "Retro", durations: [60], description: "Himnos de la década dorada del pop." },
    { title: "Sesión chill", genre: "Chill", durations: [60, 120], description: "Música relajada para cualquier momento." },
    { title: "Rock en vivo", genre: "Rock", durations: [60], description: "Conciertos y actuaciones en directo." },
    { title: "Latin party", genre: "Latino", durations: [60], description: "Reguetón, salsa y ritmos latinos." },
    { title: "Lista de éxitos", genre: "Pop", durations: [120], description: "Cuenta atrás con los 40 temas más votados." },
    { title: "Noche electrónica", genre: "Electrónica", durations: [120], description: "Sesiones de los mejores DJ." },
  ],
  documentales: [
    { title: "Misión espacial", genre: "Ciencia", durations: [60], description: "Seguimiento de misiones y lanzamientos." },
    { title: "Naturaleza salvaje", genre: "Naturaleza", durations: [60], description: "Fauna y paisajes extraordinarios." },
    { title: "Grandes civilizaciones", genre: "Historia", durations: [60], description: "Un viaje por las culturas que cambiaron el mundo." },
    { title: "Ingeniería extrema", genre: "Tecnología", durations: [60], description: "Las construcciones más impresionantes del planeta." },
    { title: "Planeta océano", genre: "Naturaleza", durations: [60], description: "Explorando las profundidades marinas." },
    { title: "Ciencia hoy", genre: "Ciencia", durations: [30], description: "Los avances científicos más recientes." },
    { title: "Rueda de prensa", genre: "Ciencia", durations: [30, 60], description: "Comparecencia en directo." },
  ],
  generalista: [
    { title: "Magazine matinal", genre: "Magazine", durations: [120, 180], description: "Actualidad, entrevistas y entretenimiento para empezar el día." },
    { title: "Informativo", genre: "Noticias", durations: [60], description: "Las noticias del día." },
    { title: "Concurso", genre: "Concurso", durations: [60], description: "Preguntas, pruebas y premios." },
    { title: "Serie", genre: "Serie", durations: [60], description: "Capítulo de la serie de la temporada." },
    { title: "Telenovela", genre: "Telenovela", durations: [60], description: "Pasiones, intrigas y secretos familiares." },
    { title: "Cine de tarde", genre: "Cine", durations: [120], description: "Largometraje para la sobremesa." },
    { title: "Programa del corazón", genre: "Entretenimiento", durations: [90], description: "Toda la crónica social." },
    { title: "Late show", genre: "Entretenimiento", durations: [90], description: "Humor, invitados y actuaciones en directo." },
    { title: "Documental", genre: "Documental", durations: [60], description: "Reportaje de producción propia." },
  ],
  entretenimiento: [
    { title: "Motor a fondo", genre: "Motor", durations: [60], description: "Pruebas, comparativas y coches clásicos." },
    { title: "Reality", genre: "Reality", durations: [60, 90], description: "Convivencia, pruebas y nominaciones." },
    { title: "Comedia", genre: "Comedia", durations: [30], description: "Risas garantizadas con la mejor comedia." },
    { title: "Talent show", genre: "Talent", durations: [120], description: "Nuevos talentos compiten por el premio final." },
    { title: "Cocina creativa", genre: "Cocina", durations: [30, 60], description: "Recetas fáciles con grandes chefs." },
    { title: "Viajes", genre: "Viajes", durations: [60], description: "Destinos sorprendentes alrededor del mundo." },
  ],
  institucional: [
    { title: "Sesión plenaria", genre: "Parlamento", durations: [120, 180], description: "Retransmisión íntegra de la sesión plenaria." },
    { title: "Comisión", genre: "Parlamento", durations: [90, 120], description: "Comparecencias y debates en comisión." },
    { title: "Carta de ajuste", genre: "Institucional", durations: [60, 120], description: "Sin sesiones programadas." },
    { title: "Resumen parlamentario", genre: "Parlamento", durations: [30], description: "Lo más destacado de la actividad parlamentaria." },
  ],
  pruebas: [
    { title: "Señal de prueba", genre: "Test", durations: [60, 120], description: "Stream de verificación técnica." },
    { title: "Barras y tono", genre: "Test", durations: [60], description: "Patrón de calibración." },
    { title: "Contenido de demostración", genre: "Demo", durations: [120], description: "Contenido libre de derechos para pruebas de reproducción." },
  ],
};

const FALLBACK = TEMPLATES.generalista;

const DAY_MS = 24 * 60 * 60 * 1000;

function dayStartUtc(date: Date): Date {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
}

function generateDay(channelId: number, categorySlug: string | null, dayStart: Date) {
  const templates = (categorySlug && TEMPLATES[categorySlug]) || FALLBACK;
  const dayNumber = Math.floor(dayStart.getTime() / DAY_MS);
  const rng = createRng(channelId * 1000003 + dayNumber * 7919);
  const rows: Array<typeof programs.$inferInsert> = [];

  let cursor = dayStart.getTime();
  const end = cursor + DAY_MS;
  let lastIndex = -1;

  while (cursor < end) {
    let index = Math.floor(rng() * templates.length);
    if (index === lastIndex) index = (index + 1) % templates.length;
    lastIndex = index;
    const tpl = templates[index];
    const minutes = tpl.durations[Math.floor(rng() * tpl.durations.length)];
    const slotEnd = Math.min(cursor + minutes * 60000, end);
    rows.push({
      channelId,
      title: tpl.title,
      genre: tpl.genre,
      description: tpl.description,
      startTime: new Date(cursor),
      endTime: new Date(slotEnd),
      source: "generated",
    });
    cursor = slotEnd;
  }
  return rows;
}

/**
 * Guarantees that every given channel has a generated schedule covering the
 * UTC days that intersect [from, to]. Data is deterministic per channel/day.
 */
export async function ensureEpg(
  channelsInput: Array<{ id: number; categorySlug: string | null }>,
  from: Date,
  to: Date,
) {
  if (channelsInput.length === 0) return;
  const ids = channelsInput.map((c) => c.id);
  const slugById = new Map(channelsInput.map((c) => [c.id, c.categorySlug]));

  const firstDay = dayStartUtc(from);
  const lastDay = dayStartUtc(to);

  for (let day = firstDay.getTime(); day <= lastDay.getTime(); day += DAY_MS) {
    const dayStart = new Date(day);
    const dayEnd = new Date(day + DAY_MS);
    const existing = await db
      .selectDistinct({ channelId: programs.channelId })
      .from(programs)
      .where(
        and(
          inArray(programs.channelId, ids),
          gte(programs.startTime, dayStart),
          lt(programs.startTime, dayEnd),
        ),
      );
    const have = new Set(existing.map((e) => e.channelId));
    const rows: Array<typeof programs.$inferInsert> = [];
    for (const id of ids) {
      if (have.has(id)) continue;
      rows.push(...generateDay(id, slugById.get(id) ?? null, dayStart));
    }
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(programs).values(rows.slice(i, i + 500));
    }
  }
}

export async function getNowPlaying(channelIds: number[], now = new Date()) {
  if (channelIds.length === 0) return new Map<number, Program>();
  const rows = await db
    .select()
    .from(programs)
    .where(
      and(
        inArray(programs.channelId, channelIds),
        lte(programs.startTime, now),
        gt(programs.endTime, now),
      ),
    );
  const map = new Map<number, Program>();
  for (const row of rows) map.set(row.channelId, row);
  return map;
}

export async function getSchedule(channelIds: number[], from: Date, to: Date) {
  if (channelIds.length === 0) return [] as Program[];
  return db
    .select()
    .from(programs)
    .where(
      and(
        inArray(programs.channelId, channelIds),
        lt(programs.startTime, to),
        gt(programs.endTime, from),
      ),
    )
    .orderBy(asc(programs.channelId), asc(programs.startTime));
}

export async function getUpcoming(channelId: number, now = new Date(), limit = 6) {
  return db
    .select()
    .from(programs)
    .where(and(eq(programs.channelId, channelId), gt(programs.endTime, now)))
    .orderBy(asc(programs.startTime))
    .limit(limit);
}
