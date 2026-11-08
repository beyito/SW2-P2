<?php

use App\InterfaceAdapters\Http\CrmController;
use Illuminate\Support\Facades\Route;

Route::get('/health', [CrmController::class, 'health']);

// Datos personales de clientes: solo para el personal del salón
Route::get('/api/clients', [CrmController::class, 'clients'])->middleware('keycloak:ADMIN,STYLIST,RECEPTIONIST');

Route::get('/api/invoices/{id}/comprobante', [CrmController::class, 'receipt'])->middleware('keycloak');
