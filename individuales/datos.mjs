// ---------------------------------------------------------------------------
// Toda la información editable del individual vive acá.
// Cambiá los textos, guardá y volvé a correr:  node individuales/generar.mjs
// ---------------------------------------------------------------------------

// Medidas de la pieza troquelada, en milímetros.
export const medidas = {
  ancho: 420,      // 42 cm
  alto: 300,       // 30 cm
  sangrado: 3,     // margen extra para el corte
  curva: '62%',    // altura del arco de medio punto (más alto = más curvo)
};

export const marca = {
  nombre: 'DOMOS',
  lema: 'Glamping & naturaleza',
  acento: '#D9722F',           // color de las pastillas
  acentoTexto: '#FFFFFF',
  instagram: 'PENDIENTE',      // ← usuario real, sin @
  whatsapp: '+56 9 0000 0000', // ← PENDIENTE
  web: 'www.domos.cl',         // ← PENDIENTE
};

// Cada columna es una lista de grupos: { titulo, items }.
// Un item puede ser texto suelto o { texto, nota } para agregar una bajada.
export const versiones = {
  playa: {
    archivo: 'individual-domos-playa',
    lugar: 'Playa Bonita',
    fondo: 'fondos/playa.jpg',
    // Velo sobre la foto: sube el contraste del texto sin apagar la imagen.
    velo:
      'linear-gradient(180deg, rgba(0,0,0,.34) 0%, rgba(0,0,0,.10) 34%, rgba(0,0,0,.06) 62%, rgba(0,0,0,.28) 100%)',
    columnaIzq: [
      {
        titulo: 'Tu estadía',
        items: [
          { texto: 'Check-in 15:00 h' },
          { texto: 'Check-out 12:00 h' },
          { texto: 'Desayuno', nota: '8:30 a 10:30 h' },
        ],
      },
      {
        titulo: 'Wi-Fi',
        items: [
          { texto: 'Domos_Huespedes', nota: 'Clave: PENDIENTE' },
        ],
      },
    ],
    columnaDer: [
      {
        titulo: 'Servicios',
        items: [
          { texto: 'Tinaja caliente', nota: 'con reserva previa' },
          { texto: 'Quincho equipado' },
          { texto: 'Estacionamiento privado' },
        ],
      },
      {
        titulo: 'Cerca tuyo',
        items: [
          { texto: 'Playa a 3 min' },
          { texto: 'Caleta y marisquerías' },
          { texto: 'Mirador del atardecer' },
        ],
      },
    ],
  },

  bosque: {
    archivo: 'individual-domos-bosque',
    lugar: 'Bosque',
    fondo: 'fondos/bosque.jpg',
    velo:
      'linear-gradient(180deg, rgba(0,0,0,.38) 0%, rgba(0,0,0,.14) 34%, rgba(0,0,0,.10) 62%, rgba(0,0,0,.32) 100%)',
    columnaIzq: [
      {
        titulo: 'Tu estadía',
        items: [
          { texto: 'Check-in 15:00 h' },
          { texto: 'Check-out 12:00 h' },
          { texto: 'Desayuno', nota: '8:30 a 10:30 h' },
        ],
      },
      {
        titulo: 'Wi-Fi',
        items: [
          { texto: 'Domos_Huespedes', nota: 'Clave: PENDIENTE' },
        ],
      },
    ],
    columnaDer: [
      {
        titulo: 'Servicios',
        items: [
          { texto: 'Tinaja caliente', nota: 'con reserva previa' },
          { texto: 'Quincho equipado' },
          { texto: 'Fogata al anochecer' },
        ],
      },
      {
        titulo: 'Cerca tuyo',
        items: [
          { texto: 'Sendero del bosque' },
          { texto: 'Cascada a 20 min' },
          { texto: 'Mirador del valle' },
        ],
      },
    ],
  },
};
