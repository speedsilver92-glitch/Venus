import { Container, getContainer } from '@cloudflare/containers';
import { env } from 'cloudflare:workers';

export class PrivoraContainer extends Container {
  defaultPort = 3001;
  sleepAfter = '30m';
  envVars = {
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '3001',
    CLIENT_ORIGIN: '',
    JWT_SECRET: env.JWT_SECRET
  };
}

export default {
  async fetch(request, env) {
    // A stable container key keeps HTTP, Socket.IO and WebRTC signaling
    // on the same app instance while this JSON-store prototype is used.
    const app = getContainer(env.PRIVORA_CONTAINER, 'privora-primary');
    return app.fetch(request);
  }
};
