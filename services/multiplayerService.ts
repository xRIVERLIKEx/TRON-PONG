
import { NetworkPacket, NetworkRole } from '../types';
import { Peer, DataConnection } from 'peerjs';

class MultiplayerService {
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private onMessageCallback: ((packet: NetworkPacket) => void) | null = null;
  private onConnectCallback: (() => void) | null = null;
  private role: NetworkRole = NetworkRole.NONE;

  public init(role: NetworkRole, roomCode: string): Promise<string> {
    this.role = role;
    this.cleanup();

    return new Promise((resolve, reject) => {
      // Use the room code as the Peer ID. 
      // Note: In production, you'd want a more unique ID or a signaling server.
      // We prefix to avoid collisions with other PeerJS users.
      const peerId = `tron-pong-${roomCode}`;
      
      this.peer = new Peer(role === NetworkRole.HOST ? peerId : undefined);

      this.peer.on('open', (id) => {
        console.log('Peer opened with ID:', id);
        if (role === NetworkRole.GUEST) {
          this.connectToHost(peerId);
        }
        resolve(roomCode);
      });

      this.peer.on('connection', (conn) => {
        if (this.role === NetworkRole.HOST) {
          this.setupConnection(conn);
        }
      });

      this.peer.on('error', (err) => {
        console.error('Peer error:', err);
        reject(err);
      });
    });
  }

  private connectToHost(hostPeerId: string) {
    if (!this.peer) return;
    const conn = this.peer.connect(hostPeerId, { serialization: 'json' });
    this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection) {
    this.connection = conn;
    
    this.connection.on('open', () => {
      console.log('Data connection opened');
      if (this.onConnectCallback) this.onConnectCallback();
    });

    this.connection.on('data', (data) => {
      const packet = data as NetworkPacket;
      if (this.onMessageCallback) {
        this.onMessageCallback(packet);
      }
    });

    this.connection.on('close', () => {
      console.log('Connection closed');
      this.cleanup();
    });
  }

  public send(type: NetworkPacket['type'], payload: any) {
    if (this.connection && this.connection.open) {
      this.connection.send({
        type,
        payload,
        role: this.role
      });
    }
  }

  public onMessage(callback: (packet: NetworkPacket) => void) {
    this.onMessageCallback = callback;
  }

  public onConnect(callback: () => void) {
    this.onConnectCallback = callback;
  }

  public cleanup() {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.role = NetworkRole.NONE;
  }

  public disconnect() {
    this.cleanup();
  }
}

export const multiplayerService = new MultiplayerService();
