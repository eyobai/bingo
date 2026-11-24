import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthGuard } from '../common/common';
import { NotifyService } from '../notify.service';
import { WalletService } from '../wallet/wallet.service';
import { GameService } from './game.service';
import { RocketService } from '../rocket/rocket.service';

/**
 * Live updates. Clients connect (optionally with their token), then `join` a room and receive `state`
 * on every change: countdown start, cards taken, each ball, the result. Signed-in clients also get
 * `wallet` whenever their balances change.
 */
@WebSocketGateway({ cors: { origin: true, credentials: false }, path: '/socket.io' })
export class GameGateway implements OnGatewayConnection, OnModuleInit {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('Socket');

  constructor(
    private readonly game: GameService,
    private readonly auth: AuthGuard,
    private readonly notify: NotifyService,
    private readonly wallet: WalletService,
    private readonly rocket: RocketService,
  ) {}

  onModuleInit() {
    this.rocket.on('state', () => {
      this.server?.to('rocket').emit('rocket', this.rocket.publicState());
    });
    this.game.on('state', (roomId) => {
      this.server?.to(`room:${roomId}`).emit('state', this.game.publicState(roomId));
    });
    this.notify.on('walletChanged', (userId) => {
      this.wallet
        .balances(userId)
        .then((b) => this.server?.to(`user:${userId}`).emit('wallet', b))
        .catch((e: Error) => this.logger.warn(`wallet push failed: ${e.message}`));
    });
  }

  handleConnection(socket: Socket) {
    const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
    const user = this.auth.verify(token);
    if (user) {
      socket.data.userId = user.id;
      void socket.join(`user:${user.id}`);
    }
  }

  /** Leyu Rocket viewers: one shared channel for the whole game. */
  @SubscribeMessage('rocket:join')
  async rocketJoin(@ConnectedSocket() socket: Socket) {
    await socket.join('rocket');
    socket.emit('rocket', this.rocket.publicState());
    return { ok: true };
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: { roomId?: string }) {
    const roomId = String(body?.roomId ?? '');
    const state = this.game.publicState(roomId);
    if (!state) return { ok: false };
    for (const r of socket.rooms) if (r.startsWith('room:')) await socket.leave(r);
    await socket.join(`room:${roomId}`);
    socket.emit('state', state);
    return { ok: true };
  }
}
