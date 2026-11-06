/** Publica eventos para otros servicios; un fallo nunca debe revertir la operación ya realizada. */
export interface IEventPublisher {
  publish(routingKey: string, body: Record<string, unknown>): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('IEventPublisher');
