import os from 'node:os';
import { createGameServer } from './app';

const PORT = Number(process.env.PORT || 5310);
const { httpServer } = createGameServer();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[draw-guess] server listening on http://localhost:${PORT}`);
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`[draw-guess] LAN:  http://${iface.address}:${PORT}  (手机同网段可访问)`);
      }
    }
  }
});
