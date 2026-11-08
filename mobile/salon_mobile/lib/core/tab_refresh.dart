import 'package:flutter/foundation.dart';

/// Pestaña seleccionada en la pantalla principal. Las pestañas viven en un IndexedStack y no se reconstruyen:
/// con esto cada una vuelve a cargar sus datos al abrirse, para no mostrar lo de antes de un pago.
class TabRefresh {
  final ValueListenable<int> selected;
  final int index;

  const TabRefresh(this.selected, this.index);

  /// Llama a [reload] cada vez que se abre esta pestaña. Devuelve la función que deja de escuchar.
  VoidCallback listen(VoidCallback reload) {
    void onChange() {
      if (selected.value == index) reload();
    }

    selected.addListener(onChange);
    return () => selected.removeListener(onChange);
  }
}
