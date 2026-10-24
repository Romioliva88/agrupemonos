"use strict";

function sugerirRepartoTareas(tareas, integrantes) {
  if (!Array.isArray(tareas) || !Array.isArray(integrantes)) return [];

  const personas = [...new Map(
    integrantes
      .map(nombre => String(nombre ?? "").trim())
      .filter(Boolean)
      .map(nombre => [nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(), nombre])
  ).values()];

  if (!personas.length) return [];

  const carga = new Map(personas.map(nombre => [nombre, 0]));
  const clave = nombre => String(nombre ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const nombres = new Map(personas.map(nombre => [clave(nombre), nombre]));
  const esfuerzoDe = tarea => {
    const n = Number(tarea?.esfuerzo);
    return Number.isFinite(n) && n >= 1 ? Math.min(5, n) : 1;
  };

  const disponibles = [];
  for (const tarea of tareas) {
    if (!tarea || typeof tarea !== "object") continue;
    const responsable = nombres.get(clave(tarea.responsable));
    const esfuerzo = esfuerzoDe(tarea);

    // Respetar todas las tareas asignadas, cualquiera que sea su estado.
    // Su carga pendiente/en curso cuenta para equilibrar el trabajo restante.
    if (responsable && tarea.estado !== "Completada") {
      carga.set(responsable, carga.get(responsable) + esfuerzo);
    }

    if (tarea.estado === "Pendiente" && !String(tarea.responsable ?? "").trim()) {
      disponibles.push({ ...tarea, esfuerzo });
    }
  }

  disponibles.sort((a, b) => b.esfuerzo - a.esfuerzo);
  return disponibles.map(tarea => {
    const responsableSugerido = personas.reduce((mejor, persona) =>
      carga.get(persona) < carga.get(mejor) ? persona : mejor
    );
    carga.set(responsableSugerido, carga.get(responsableSugerido) + tarea.esfuerzo);
    return { ...tarea, responsableSugerido };
  });
}
