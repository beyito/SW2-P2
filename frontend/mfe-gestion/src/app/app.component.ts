import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GestionApiService, InventoryItem, Appointment } from './services/gestion-api.service';

interface McpMessage {
  sender: 'user' | 'agent';
  text: string;
  time: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  activeTab: 'inventory' | 'schedule' | 'mcp' = 'inventory';

  inventory: InventoryItem[] = [];
  appointments: Appointment[] = [];
  
  // New Item form (CU-08)
  newItemName = '';
  newItemCategory = 'COLORACION';
  newItemStock = 10;
  newItemMin = 3;

  // MCP Chat state (CU-17, CU-18)
  mcpMessages: McpMessage[] = [
    { sender: 'agent', text: 'Hola Valentina. Soy el Agente Autónomo del Salón (Servidor MCP sobre puerto 4000). ¿En qué puedo asistirte?', time: '10:00' }
  ];
  userPrompt = '';
  isAgentLoading = false;

  constructor(private apiService: GestionApiService) {}

  ngOnInit(): void {
    this.apiService.getInventory().subscribe(items => this.inventory = items);
    this.apiService.getAppointments().subscribe(apts => this.appointments = apts);
  }

  get criticalCount(): number {
    return this.inventory.filter(i => i.currentStock <= i.minStock).length;
  }

  restock(id: string): void {
    const item = this.inventory.find(i => i.id === id);
    if (item) {
      item.currentStock += 5;
    }
  }

  addInventoryItem(): void {
    if (!this.newItemName.trim()) return;
    this.inventory.unshift({
      id: 'inv-' + (this.inventory.length + 1),
      name: this.newItemName,
      category: this.newItemCategory,
      currentStock: this.newItemStock,
      minStock: this.newItemMin,
      supplier: 'Proveedor Oficial',
      unit: 'unidades'
    });
    this.newItemName = '';
    this.newItemStock = 10;
    this.newItemMin = 3;
  }

  sendMcpPrompt(promptOverride?: string): void {
    const textToSend = promptOverride || this.userPrompt;
    if (!textToSend.trim()) return;

    this.mcpMessages.push({ sender: 'user', text: textToSend, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    this.userPrompt = '';
    this.isAgentLoading = true;

    this.apiService.queryMcpAgent(textToSend).subscribe(reply => {
      setTimeout(() => {
        this.mcpMessages.push({ sender: 'agent', text: reply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        this.isAgentLoading = false;
      }, 500);
    });
  }
}
