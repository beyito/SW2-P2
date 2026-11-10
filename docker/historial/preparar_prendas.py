"""
Descarga las fotos de las prendas de demostración (CC0 o dominio público, vía Openverse), las
reduce a menos de 1 megapíxel y escribe prendas.json y CREDITOS.md. Requiere Pillow:

  python preparar_prendas.py <indice.json de Openverse> [<otro indice.json> ...]

Las fotos ya preparadas quedan en prendas/ dentro del repositorio: solo hace falta correrlo para cambiarlas.
"""
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

UA = 'SalonSW2/1.0 (proyecto academico)'
LADO = 900  # 900 x 900 = 0,81 MP: Replicate cobra por megapíxel redondeado hacia arriba

# clave de Openverse -> (archivo, nombre, categoría, color, temporada, etiquetas)
PRENDAS = {
    'white_sneakers_1': ('sueter-tejido-blanco', 'Suéter tejido blanco', 'TOP', 'Blanco', 'WINTER', ['casual', 'abrigado']),
    't-shirt_mockup_2': ('polera-celeste', 'Polera celeste estampada', 'TOP', 'Celeste', 'SUMMER', ['casual', 'urbano']),
    'cardigan_0': ('cardigan-colores', 'Cárdigan tejido de colores', 'TOP', 'Multicolor', 'AUTUMN', ['bohemio', 'tejido']),
    'linen_pants_2': ('pantalon-recto-azul', 'Pantalón recto azul grisáceo', 'BOTTOM', 'Azul', 'ALL_SEASON', ['clásico', 'oficina']),
    'pleated_skirt_0': ('falda-plisada-cuadros', 'Falda plisada a cuadros', 'BOTTOM', 'Azul y rojo', 'AUTUMN', ['clásico', 'colegial']),
    'pleated_skirt_1': ('falda-plisada-verde', 'Falda plisada verde oscuro con borde rojo', 'BOTTOM', 'Verde oscuro', 'ALL_SEASON', ['elegante', 'noche']),
    'denim_jacket_1': ('chaqueta-jean', 'Chaqueta de jean', 'OUTERWEAR', 'Azul', 'SPRING', ['casual', 'urbano']),
    'white_sneakers_3': ('zapatillas-blancas', 'Zapatillas blancas', 'SHOES', 'Blanco', 'ALL_SEASON', ['casual', 'deportivo']),
    'high_heels_4': ('tacones-rojos', 'Tacones rojos de gamuza', 'SHOES', 'Rojo', 'ALL_SEASON', ['elegante', 'fiesta']),
    'high_heels_3': ('tacones-plateados', 'Tacones plateados con brillo', 'SHOES', 'Plateado', 'ALL_SEASON', ['gala', 'evento']),
    'handbag_7': ('cartera-cuero-cafe', 'Cartera de cuero café', 'ACCESSORY', 'Café', 'ALL_SEASON', ['clásico', 'oficina']),
    'sunglasses_0': ('lentes-sol-amarillos', 'Lentes de sol amarillos', 'ACCESSORY', 'Amarillo', 'SUMMER', ['playa', 'divertido']),
    'scarf_7': ('bufandas-tejidas', 'Bufandas tejidas', 'ACCESSORY', 'Verde y gris', 'WINTER', ['abrigado', 'tejido']),
}

# Clóset de Alejandro: ropa de hombre y, además, las prendas unisex de la lista anterior
PRENDAS_HOMBRE = {
    'mens_shirt_1': ('camisa-cuadros', 'Camisa de vestir a cuadros', 'TOP', 'Blanco y negro', 'ALL_SEASON', ['formal', 'oficina']),
    'button_down_shirt_1': ('camisa-celeste', 'Camisa celeste manga larga', 'TOP', 'Celeste', 'SPRING', ['casual', 'oficina']),
    'knit_sweater_4': ('sueter-beige', 'Suéter tejido beige', 'TOP', 'Beige', 'WINTER', ['abrigado', 'casual']),
    'plain_t-shirt_2': ('poleras-basicas', 'Poleras básicas lisas', 'TOP', 'Varios', 'SUMMER', ['básico', 'casual']),
    'mens_sneakers_4': ('pantalon-chino-caqui', 'Pantalón chino caqui', 'BOTTOM', 'Caqui', 'ALL_SEASON', ['casual', 'urbano']),
    'suit_jacket_0': ('saco-azul-marino', 'Saco azul marino', 'OUTERWEAR', 'Azul marino', 'ALL_SEASON', ['formal', 'evento']),
    'leather_shoes_0': ('zapatos-cuero-cafe', 'Zapatos de cuero café', 'SHOES', 'Café', 'ALL_SEASON', ['formal', 'clásico']),
    'leather_shoes_6': ('zapatos-tejidos-miel', 'Zapatos tejidos color miel', 'SHOES', 'Miel', 'SUMMER', ['casual', 'elegante']),
    'mens_sneakers_0': ('zapatillas-deportivas', 'Zapatillas deportivas blancas', 'SHOES', 'Blanco', 'ALL_SEASON', ['deportivo', 'urbano']),
    'wrist_watch_0': ('reloj-correa-negra', 'Reloj de correa negra', 'ACCESSORY', 'Negro', 'ALL_SEASON', ['clásico', 'minimalista']),
    'leather_belt_2': ('cinturon-cuero', 'Cinturón de cuero café', 'ACCESSORY', 'Café', 'ALL_SEASON', ['clásico', 'formal']),
}
UNISEX = ['white_sneakers_1', 'linen_pants_2', 'denim_jacket_1', 'white_sneakers_3', 'sunglasses_0', 'scarf_7']

indice = {}
for archivo in sys.argv[1:]:
    indice.update(json.loads(Path(archivo).read_text(encoding='utf-8')))

carpeta = Path(__file__).parent / 'prendas'
carpeta.mkdir(exist_ok=True)
creditos = []


def prenda(archivo, nombre, categoria, color, temporada, etiquetas):
    return {'archivo': f'{archivo}.jpg', 'name': nombre, 'category': categoria, 'color': color,
            'season': temporada, 'tags': etiquetas + ['demo']}


for clave, (archivo, nombre, categoria, color, temporada, etiquetas) in {**PRENDAS, **PRENDAS_HOMBRE}.items():
    fuente = indice[clave]
    assert fuente['license'] in ('cc0', 'pdm'), (clave, fuente['license'])
    datos = urllib.request.urlopen(urllib.request.Request(fuente['url'], headers={'User-Agent': UA}), timeout=90).read()
    imagen = Image.open(io.BytesIO(datos)).convert('RGB')
    imagen.thumbnail((LADO, LADO))
    imagen.save(carpeta / f'{archivo}.jpg', 'JPEG', quality=85, optimize=True)
    licencia = 'CC0 1.0' if fuente['license'] == 'cc0' else 'Dominio público'
    autor = fuente.get('creator') or 'autor desconocido'
    creditos.append(f"| {nombre} | {fuente.get('title') or '-'} | {autor} | {licencia} | {fuente['foreign_landing_url']} |")
    print(f'{archivo}: {imagen.size[0]}x{imagen.size[1]}')

listas = {
    'prendas.json': [prenda(*v) for v in PRENDAS.values()],
    'prendas-hombre.json': [prenda(*v) for v in PRENDAS_HOMBRE.values()] + [prenda(*PRENDAS[c]) for c in UNISEX],
}
for nombre, lista in listas.items():
    (carpeta / nombre).write_text(json.dumps(lista, ensure_ascii=False, indent=1), encoding='utf-8', newline='\n')
(carpeta / 'CREDITOS.md').write_text(
    '# Créditos de las fotos de prendas\n\n'
    'Fotos de demostración del clóset virtual, todas con licencia CC0 o de dominio público, obtenidas con '
    '[Openverse](https://openverse.org). No exigen atribución; igual se deja la fuente de cada una.\n\n'
    '| Prenda | Título original | Autor | Licencia | Fuente |\n| :--- | :--- | :--- | :--- | :--- |\n'
    + '\n'.join(creditos) + '\n', encoding='utf-8', newline='\n')
