/**
 * Port: the client side of an attached ACP session — a bidirectional
 * newline-delimited JSON frame stream. Adapter implementations wrap concrete
 * transports (WebSocket today; plain TCP, fetch streams, or test doubles
 * later) and expose this uniform surface to the service.
 */
export interface ClientChannel {
  send(line: string): void;
  close(code?: number, reason?: string): void;
  isOpen(): boolean;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
}
