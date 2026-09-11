// ---------------------------------------------------------------------------
// Toda la información editable del individual vive aquí.
// Cambiá los textos, guardá y volvé a correr:  node individuales/generar.mjs
// ---------------------------------------------------------------------------

// Datos comunes a las dos versiones (playa y bosque).
export const marca = {
  nombre: 'DOMOS',
  lema: 'Glamping & naturaleza',
  instagram: 'PENDIENTE',          // ← poné acá el usuario real, sin @
  whatsapp: '+56 9 0000 0000',     // ← PENDIENTE
  web: 'www.domos.cl',             // ← PENDIENTE
  correo: 'hola@domos.cl',         // ← PENDIENTE
};

// Bloques de información. Agregá, sacá o reordená los que quieras:
// cada bloque es { icono, titulo, lineas: [...] }.
// Iconos disponibles: wifi, reloj, servicios, mapa, corazon, cafe.
const bloquesComunes = [
  {
    icono: 'wifi',
    titulo: 'Wi-Fi',
    lineas: ['Red: <b>Domos_Huespedes</b>', 'Clave: <b>PENDIENTE</b>'],
  },
  {
    icono: 'reloj',
    titulo: 'Tu estadía',
    lineas: ['Check-in: 15:00 h', 'Check-out: 12:00 h', 'Desayuno: 8:30 a 10:30 h'],
  },
  {
    icono: 'servicios',
    titulo: 'Servicios',
    lineas: ['Tinaja caliente (con reserva)', 'Quincho equipado', 'Estacionamiento privado'],
  },
];

export const versiones = {
  playa: {
    archivo: 'individual-domos-playa',
    lugar: 'Playa Bonita',
    fondo: 'fondos/playa.jpg',
    paleta: {
      tinta: '#062A38',
      acento: '#E9B872',
      suave: '#8FD3CC',
      panel: 'rgba(5, 34, 45, 0.60)',
      velo: 'linear-gradient(100deg, rgba(4,28,38,.90) 0%, rgba(4,28,38,.74) 38%, rgba(4,28,38,.34) 68%, rgba(4,28,38,.55) 100%)',
    },
    bienvenida:
      'Despertar con el sonido del mar y desayunar mirando el horizonte. ' +
      'Este es tu rincón: tómate el tiempo que quieras.',
    bloques: [
      ...bloquesComunes,
      {
        icono: 'mapa',
        titulo: 'Cerca tuyo',
        lineas: ['Playa a 3 min caminando', 'Caleta y marisquerías', 'Mirador del atardecer'],
      },
    ],
  },

  bosque: {
    archivo: 'individual-domos-bosque',
    lugar: 'Bosque',
    fondo: 'fondos/bosque.jpg',
    paleta: {
      tinta: '#13291C',
      acento: '#D3AC5B',
      suave: '#A9C6A0',
      panel: 'rgba(10, 29, 19, 0.62)',
      velo: 'linear-gradient(100deg, rgba(9,26,17,.90) 0%, rgba(9,26,17,.74) 38%, rgba(9,26,17,.32) 68%, rgba(9,26,17,.55) 100%)',
    },
    bienvenida:
      'Entre árboles nativos y aire limpio, acá el plan es simple: ' +
      'desconectar, respirar hondo y quedarse un rato más.',
    bloques: [
      ...bloquesComunes,
      {
        icono: 'mapa',
        titulo: 'Cerca tuyo',
        lineas: ['Sendero del bosque', 'Cascada a 20 min', 'Fogata al anochecer'],
      },
    ],
  },
};
