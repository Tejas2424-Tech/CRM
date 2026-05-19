import type { Server as SocketServer } from "socket.io";

let io: SocketServer | undefined;

export function setRealtime(server: SocketServer) {
  io = server;
}

export function emitRealtime(event: string, payload: unknown) {
  io?.emit(event, payload);
}
