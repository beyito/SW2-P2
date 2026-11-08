import 'package:flutter/material.dart';

/// Colores del salón: los mismos que la web (crema, rosa empolvado y dorado).
class SalonColors {
  static const background = Color(0xFFFBF6F2);
  static const surface = Color(0xFFFFFFFF);
  static const soft = Color(0xFFF6EDE8);
  static const border = Color(0xFFEBDDD5);
  static const rose = Color(0xFFC98B8B);
  static const roseSoft = Color(0xFFF7E7E4);
  static const roseDeep = Color(0xFF9E6066);
  static const gold = Color(0xFF8C6A3F);
  static const goldSoft = Color(0xFFF3EADF);
  static const text = Color(0xFF3D2F2D);
  static const textSecondary = Color(0xFF7D6A65);
  static const success = Color(0xFF4F7D5B);
  static const danger = Color(0xFFA8464C);
  static const warning = Color(0xFF8A6424);
}

/// Títulos con letra serif, como en la web; el resto con la letra del sistema.
const _serif = 'serif';

ThemeData salonTheme() {
  const scheme = ColorScheme.light(
    primary: SalonColors.roseDeep,
    onPrimary: Colors.white,
    secondary: SalonColors.gold,
    onSecondary: Colors.white,
    surface: SalonColors.surface,
    onSurface: SalonColors.text,
    error: SalonColors.danger,
    outline: SalonColors.border,
  );
  final rounded = RoundedRectangleBorder(borderRadius: BorderRadius.circular(999));
  OutlineInputBorder field(Color color) =>
      OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: color));

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: SalonColors.background,
    textTheme: const TextTheme(
      headlineSmall: TextStyle(fontFamily: _serif, color: SalonColors.text, fontWeight: FontWeight.w600),
      titleLarge: TextStyle(fontFamily: _serif, color: SalonColors.text, fontWeight: FontWeight.w600),
      titleMedium: TextStyle(color: SalonColors.text, fontWeight: FontWeight.w700),
      bodyMedium: TextStyle(color: SalonColors.text),
      bodySmall: TextStyle(color: SalonColors.textSecondary),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: SalonColors.background,
      foregroundColor: SalonColors.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontFamily: _serif, fontSize: 22, fontWeight: FontWeight.w600, color: SalonColors.text),
    ),
    cardTheme: CardThemeData(
      color: SalonColors.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: SalonColors.border),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(backgroundColor: SalonColors.roseDeep, foregroundColor: Colors.white, shape: rounded),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: SalonColors.roseDeep,
        foregroundColor: Colors.white,
        elevation: 0,
        shape: rounded,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: SalonColors.roseDeep,
        side: const BorderSide(color: SalonColors.rose),
        shape: rounded,
      ),
    ),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: SalonColors.roseDeep)),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: SalonColors.surface,
      labelStyle: const TextStyle(color: SalonColors.textSecondary),
      border: field(SalonColors.border),
      enabledBorder: field(SalonColors.border),
      focusedBorder: field(SalonColors.rose),
    ),
    chipTheme: const ChipThemeData(
      backgroundColor: SalonColors.goldSoft,
      selectedColor: SalonColors.roseSoft,
      labelStyle: TextStyle(color: SalonColors.text),
      side: BorderSide(color: SalonColors.border),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: SalonColors.surface,
      indicatorColor: SalonColors.roseSoft,
      // Ícono activo en rosa vino: en blanco no se vería sobre el indicador claro
      iconTheme: WidgetStateProperty.resolveWith((states) => IconThemeData(
            color: states.contains(WidgetState.selected) ? SalonColors.roseDeep : SalonColors.textSecondary,
          )),
      labelTextStyle: WidgetStateProperty.resolveWith((states) => TextStyle(
            fontSize: 12,
            fontWeight: states.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
            color: states.contains(WidgetState.selected) ? SalonColors.roseDeep : SalonColors.textSecondary,
          )),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: SalonColors.surface,
      selectedItemColor: SalonColors.roseDeep,
      unselectedItemColor: SalonColors.textSecondary,
    ),
    tabBarTheme: const TabBarThemeData(
      labelColor: SalonColors.roseDeep,
      unselectedLabelColor: SalonColors.textSecondary,
      indicatorColor: SalonColors.roseDeep,
    ),
    dividerTheme: const DividerThemeData(color: SalonColors.border),
    snackBarTheme: const SnackBarThemeData(backgroundColor: SalonColors.text),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: SalonColors.roseDeep),
  );
}
