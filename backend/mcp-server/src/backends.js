/**
 * Clientes GraphQL de los microservicios. El Servidor MCP nunca toca una base de datos (RNF-02):
 * reenvía el token de quien llama, y cada servicio vuelve a validar su identidad y su rol.
 */
const REQUEST_TIMEOUT_MS = 8000;

/** Error de un servicio de la plataforma, con un mensaje apto para mostrarse al agente. */
class BackendError extends Error {}

async function queryGraphql(url, query, variables, token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new BackendError('El servicio de datos no está disponible en este momento.');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new BackendError(`El servicio de datos respondió ${response.status}.`);
  }
  if (body.errors?.length) {
    throw new BackendError(body.errors[0].message);
  }
  if (!response.ok || !body.data) {
    throw new BackendError(`El servicio de datos respondió ${response.status}.`);
  }
  return body.data;
}

/** Crea el acceso a los datos del salón para el token de una petición. */
function createBackends({ gestionUrl, crmUrl, fetchImpl = fetch }) {
  return (token) => {
    const gestion = (query, variables) => queryGraphql(gestionUrl, query, variables, token, fetchImpl);
    const crm = (query, variables) => queryGraphql(crmUrl, query, variables, token, fetchImpl);

    return {
      async stylists() {
        return (await gestion('{ getStylists { id name specialty rating { average count } } }')).getStylists;
      },
      async services() {
        return (await gestion('{ getServices { id name durationMinutes price } }')).getServices;
      },
      async availableSlots(stylistId, serviceId, date) {
        const data = await gestion(
          'query ($stylistId: String!, $serviceId: String!, $date: String!) {' +
            ' getAvailableSlots(stylistId: $stylistId, serviceId: $serviceId, date: $date) { start end } }',
          { stylistId, serviceId, date },
        );
        return data.getAvailableSlots;
      },
      async criticalStock() {
        const data = await gestion('{ getCriticalStockItems { id code name category currentStock minimumStock } }');
        return data.getCriticalStockItems;
      },
      async inventory() {
        return (await gestion('{ getAllInventory { id code name category currentStock minimumStock isCriticalStock } }')).getAllInventory;
      },
      async inventoryItem(id) {
        const data = await gestion('query ($id: ID!) { getInventoryItem(id: $id) { id name currentStock minimumStock } }', { id });
        return data.getInventoryItem;
      },
      async updateStock(id, quantityChange, reason) {
        const data = await gestion(
          'mutation ($input: UpdateStockInput!) { updateStock(input: $input) { id name currentStock minimumStock } }',
          { input: { id, quantityChange, reason } },
        );
        return data.updateStock;
      },
      async panelAgenda(from, to) {
        const data = await gestion(
          'query ($from: String!, $to: String!) { getPanelAgenda(from: $from, to: $to) { id stylistId stylistName serviceName appointmentDate appointmentEnd durationMinutes status } }',
          { from, to },
        );
        return data.getPanelAgenda;
      },
      async appointment(id) {
        const data = await gestion(
          'query ($id: ID!) { getAppointmentById(id: $id) { id stylistId serviceId serviceName stylistName appointmentDate status } }',
          { id },
        );
        return data.getAppointmentById;
      },
      async reschedule(id, newDate) {
        const data = await gestion(
          'mutation ($id: ID!, $newDate: String!) { rescheduleAppointment(id: $id, newDate: $newDate) { id appointmentDate status } }',
          { id, newDate },
        );
        return data.rescheduleAppointment;
      },
      async panelSummary(from, to) {
        const data = await gestion(
          'query ($from: String!, $to: String!) { getPanelSummary(from: $from, to: $to) {' +
            ' totalAppointments pendingPayment active completed cancelled bookedValue occupancyRate } }',
          { from, to },
        );
        return data.getPanelSummary;
      },
      async crmMetrics(from, to) {
        const data = await crm(
          'query ($from: String!, $to: String!) { getCrmMetrics(from: $from, to: $to) {' +
            ' revenue refunded invoicesIssued payingClients totalClients pointsEarned pointsRedeemed } }',
          { from, to },
        );
        return data.getCrmMetrics;
      },
    };
  };
}

module.exports = { BackendError, createBackends };
