// ---------------------------------------------------------------------------
// Toda la información editable del individual vive acá.
// Cambia los textos, guarda y vuelve a correr:  node individuales/generar.mjs
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
  lema: 'El Tabo',
  acento: '#E36D18',           // naranja tomado del logo
  verde: '#97C121',
  turquesa: '#20ABCB',
  acentoTexto: '#FFFFFF',
  usuario: 'domoseltabo',                        // el mismo en las tres redes
  redes: ['facebook', 'instagram', 'tiktok'],
  web: 'cabañaseneltabo.cl',
  telefonos: ['+56 9 7889 4831', '+56 9 9102 4354'],
};

// Columna de reservas: igual en las dos versiones.
const reservas = {
  titulo: 'Reservas',
  recto: true,
  items: [
    ...marca.telefonos.map((t) => ({ texto: t })),
  ],
};

// Cada columna es una lista de grupos: { titulo, items, recto }.
// Un item puede ser texto suelto o { texto, nota } para agregar una bajada.
export const versiones = {
  playa: {
    archivo: 'individual-domos-playa',
    sector: 'Playa Bonita',
    fondo: 'fondos/playa.jpg',
    // Velo sobre la foto: sube el contraste del texto sin apagar la imagen.
    velo:
      'linear-gradient(90deg, rgba(0,0,0,.46) 0%, rgba(0,0,0,.20) 22%, rgba(0,0,0,0) 42%, rgba(0,0,0,0) 58%, rgba(0,0,0,.20) 78%, rgba(0,0,0,.46) 100%), ' +
      'linear-gradient(180deg, rgba(0,0,0,.36) 0%, rgba(0,0,0,.12) 34%, rgba(0,0,0,.08) 62%, rgba(0,0,0,.34) 100%)',
    columnaIzq: [
      {
        titulo: 'Servicios',
        items: [
          { texto: 'Frente al mar' },
          { texto: 'Piscina' },
          { texto: 'Wi-Fi' },
        ],
      },
    ],
    columnaDer: [reservas],
  },

  bosque: {
    archivo: 'individual-domos-bosque',
    sector: 'Bosque',
    fondo: 'fondos/bosque.jpg',
    velo:
      'linear-gradient(90deg, rgba(0,0,0,.46) 0%, rgba(0,0,0,.20) 22%, rgba(0,0,0,0) 42%, rgba(0,0,0,0) 58%, rgba(0,0,0,.20) 78%, rgba(0,0,0,.46) 100%), ' +
      'linear-gradient(180deg, rgba(0,0,0,.40) 0%, rgba(0,0,0,.16) 34%, rgba(0,0,0,.12) 62%, rgba(0,0,0,.38) 100%)',
    columnaIzq: [
      {
        titulo: 'Servicios',
        items: [
          { texto: 'Piscina' },
          { texto: 'Hoguera' },
          { texto: 'Gimnasio' },
          { texto: 'Parque infantil' },
          { texto: 'Sector de hamacas' },
          { texto: 'Fuente de agua' },
        ],
      },
    ],
    columnaDer: [reservas],
  },
};
