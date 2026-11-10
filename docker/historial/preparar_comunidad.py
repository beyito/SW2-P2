"""
Publicaciones de demostración del muro de la comunidad (Fase Y): descarga cada foto (CC0 o dominio
público, vía Openverse), la reduce a menos de 1 megapíxel y escribe comunidad/publicaciones.json y
comunidad/CREDITOS.md. Requiere Pillow:

  python preparar_comunidad.py <indice.json de Openverse> [<otro indice.json> ...]

Las fotos ya preparadas quedan en comunidad/ dentro del repositorio: solo hace falta correrlo para cambiarlas.
Las autoras y autores son cuentas de demostración: valentina (estilista), camila y alejandro (clientes).
"""
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

UA = 'SalonSW2/1.0 (proyecto academico)'
LADO = 900

# clave de Openverse -> (archivo, autor, título, descripción, comentarios, reacciones)
# Un comentario es (autor, texto) o (autor, texto, índice del comentario al que responde).
PUBLICACIONES = {
    'blonde_hair_3': ('mechas-balayage', 'valentina', 'Balayage en puntas',
        'Aclarado a mano alzada solo en medios y puntas: la raíz natural crece sin marcar línea. Ideal si quieres color con poco mantenimiento.',
        [('camila', '¡Me encanta! ¿Cuánto dura el color?'), ('valentina', 'Entre 3 y 4 meses, con matizador una vez por semana.', 0)], ['camila', 'alejandro']),
    'blonde_hair_0': ('trenza-espiga', 'valentina', 'Trenza espiga en rubio miel',
        'Peinado de día para un evento al aire libre. Con un poco de textura en spray se ve más natural.',
        [('camila', 'Quiero esta para el matrimonio de mi prima.')], ['camila']),
    'blonde_hair_4': ('color-turquesa', 'valentina', 'Color fantasía turquesa',
        'Decoloración controlada y depósito de color turquesa. Dura más si lavas con agua fría.',
        [('alejandro', 'Muy bueno el tono.')], ['alejandro', 'camila']),
    'blonde_hair_6': ('recogido-perlas', 'valentina', 'Recogido de novia con perlas',
        'Recogido bajo con horquillas de perla. La prueba de peinado se hace una semana antes del evento.',
        [('camila', 'Precioso. ¿Hacen prueba a domicilio?'), ('valentina', 'Sí, coordinamos por WhatsApp.', 0)], ['camila']),
    'blonde_hair_7': ('antes-despues-matizado', 'valentina', 'Antes y después del matizado',
        'Izquierda: tono amarillo después del sol. Derecha: matizado violeta de 20 minutos. Diferencia notable con poco tiempo.',
        [], ['camila', 'alejandro']),
    'curly_hair_4': ('rizos-cobrizos', 'valentina', 'Rizos cobrizos definidos',
        'Definición con crema sin enjuague y secado con difusor. El cobrizo realza el movimiento del rizo.',
        [('camila', 'Así quiero mis rizos.')], ['camila']),
    'makeup_look_6': ('rizos-naturales', 'valentina', 'Rizos naturales con volumen',
        'Corte en capas para rizo 3A: quita peso arriba y da forma redonda. Nada de plancha.',
        [], ['alejandro']),
    'makeup_look_4': ('recogido-labios-rojos', 'valentina', 'Recogido clásico con labios rojos',
        'Look de noche: recogido alto pulido y labial rojo mate. El rojo frío favorece a pieles de subtono rosado.',
        [('camila', 'Elegantísimo.')], ['camila', 'alejandro']),
    'nail_art_5': ('unas-oscuras', 'valentina', 'Uñas oscuras minimalistas',
        'Semipermanente en tono ciruela, forma almendra corta. Dura unas tres semanas.',
        [], ['camila']),
    'nail_art_7': ('unas-rojas', 'valentina', 'Uñas rojas brillantes',
        'El clásico que nunca falla. Brillo extra con top coat de gel.',
        [('camila', 'Las quiero para fin de año.')], ['camila']),
    'long_hair_1': ('ondas-al-agua', 'valentina', 'Inspiración retro: ondas al agua',
        'Ondas de los años 40, de revista de peluquería de la época. Se logran con tenaza gruesa y cepillado suave.',
        [('alejandro', 'Muy de película antigua.')], ['camila']),
    'short_haircut_1': ('bob-voluminoso', 'valentina', 'Inspiración retro: bob con volumen',
        'Bob de los años 60 con mucho cuerpo en la coronilla. Hoy lo hacemos con brushing y menos laca.',
        [], ['camila', 'alejandro']),
    'short_haircut_3': ('volumen-flequillo', 'valentina', 'Inspiración retro: volumen con flequillo',
        'Otra idea de revista de 1963: flequillo recto y volumen lateral. ¿Lo traemos de vuelta?',
        [('camila', '¡Sí! Con un poco menos de volumen.'), ('valentina', 'Hecho, una versión moderna.', 0)], ['camila']),
    'braids_hairstyle_1': ('rulos-clasicos', 'valentina', 'Cómo se colocaban los rulos',
        'Esquema de una revista de 1941 con la dirección de cada rulo. La técnica sigue sirviendo para dar volumen sin calor.',
        [], ['alejandro']),
    'blonde_hair_2': ('mi-bob-mechas', 'camila', 'Mi nuevo bob con mechas',
        'Me corté con Valentina y estoy feliz. Mucho más fácil de peinar en la mañana.',
        [('valentina', '¡Te queda increíble, Camila!'), ('camila', 'Gracias, ya agendo el retoque.', 0)], ['valentina', 'alejandro']),
    'makeup_look_7': ('mis-rizos-otono', 'camila', 'Rizos de otoño',
        'Probando la rutina para rizos que me recomendaron. Primera semana y ya noto la diferencia.',
        [('valentina', 'Se ven muy definidos. Sigue con el difusor.')], ['valentina']),
    'nail_art_6': ('mi-manicure-nude', 'camila', 'Manicure nude para la oficina',
        'Discreta y elegante. Dos semanas y sigue perfecta.',
        [], ['valentina', 'alejandro']),
    'long_hair_4': ('quiero-este-recogido', 'camila', '¿Alguien se anima a este recogido?',
        'Lo encontré en una revista antigua. ¿Se podrá hacer con mi largo?',
        [('valentina', 'Sí, con tu largo queda perfecto. Te lo hago en la próxima cita.')], ['valentina']),
    'short_haircut_7': ('ondas-cortas', 'camila', 'Ondas cortas años 50',
        'Me encantó este estilo. Lo guardo como inspiración para el verano.',
        [], ['valentina']),
    'hairdresser_7': ('mi-degradado', 'alejandro', 'Mi degradado de hoy',
        'Degradado bajo con máquina y tijera arriba. Rápido y prolijo.',
        [('valentina', 'Gracias por venir, Alejandro.'), ('camila', 'Quedó muy bien.')], ['valentina', 'camila']),
    'hairdresser_3': ('corte-tijera', 'alejandro', 'Corte con tijera para el trabajo',
        'Quería algo clásico para las reuniones. Me recomendaron dejar un poco más de largo arriba.',
        [('valentina', 'Con ese largo puedes peinarlo hacia atrás o de lado.')], ['valentina']),
    'long_hair_5': ('tupe-retro', 'alejandro', 'Tupé retro: ¿sirve para hombre?',
        'Vi este peinado antiguo y me dio curiosidad. ¿Se puede adaptar a un corte masculino?',
        [('valentina', 'Sí: el pompadour es su versión masculina. Pide la próxima vez.')], ['camila']),
    'braids_hairstyle_6': ('recogido-flequillo', 'valentina', 'Inspiración retro: recogido con flequillo',
        'De la misma revista de 1941. Buen punto de partida para un peinado de graduación.',
        [], ['camila']),
}

indice = {}
for archivo in sys.argv[1:]:
    indice.update(json.loads(Path(archivo).read_text(encoding='utf-8')))

carpeta = Path(__file__).parent / 'comunidad'
carpeta.mkdir(exist_ok=True)
lista, creditos = [], []
for clave, (archivo, autor, titulo, descripcion, comentarios, reacciones) in PUBLICACIONES.items():
    fuente = indice[clave]
    assert fuente['license'] in ('cc0', 'pdm'), (clave, fuente['license'])
    datos = urllib.request.urlopen(urllib.request.Request(fuente['url'], headers={'User-Agent': UA}), timeout=90).read()
    imagen = Image.open(io.BytesIO(datos)).convert('RGB')
    imagen.thumbnail((LADO, LADO))
    imagen.save(carpeta / f'{archivo}.jpg', 'JPEG', quality=85, optimize=True)
    lista.append({
        'archivo': f'{archivo}.jpg', 'autor': autor, 'title': titulo, 'description': descripcion,
        'comentarios': [{'autor': c[0], 'content': c[1], 'respondeA': c[2] if len(c) > 2 else None} for c in comentarios],
        'reacciones': reacciones,
    })
    licencia = 'CC0 1.0' if fuente['license'] == 'cc0' else 'Dominio público'
    creditos.append(f"| {titulo} | {fuente.get('title') or '-'} | {fuente.get('creator') or 'autor desconocido'} | {licencia} | {fuente['foreign_landing_url']} |")
    print(f'{archivo}: {imagen.size[0]}x{imagen.size[1]}')

(carpeta / 'publicaciones.json').write_text(json.dumps(lista, ensure_ascii=False, indent=1), encoding='utf-8', newline='\n')
(carpeta / 'CREDITOS.md').write_text(
    '# Créditos de las fotos de la comunidad\n\n'
    'Fotos de demostración del muro, con licencia CC0 o de dominio público, obtenidas con '
    '[Openverse](https://openverse.org). Las de «inspiración retro» son escaneos de revistas de peluquería '
    'de 1941 a 1963 que su publicador marcó como de dominio público.\n\n'
    '| Publicación | Título original | Autor | Licencia | Fuente |\n| :--- | :--- | :--- | :--- | :--- |\n'
    + '\n'.join(creditos) + '\n', encoding='utf-8', newline='\n')
