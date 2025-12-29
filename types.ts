
export enum GameStatus {
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  GAME_OVER = 'GAME_OVER',
  CONNECTING = 'CONNECTING'
}

export enum GameMode {
  SOLO = 'SOLO',
  MULTIPLAYER = 'MULTIPLAYER'
}

export enum NetworkRole {
  HOST = 'HOST',
  GUEST = 'GUEST',
  NONE = 'NONE'
}

export enum PowerUpType {
  EXTEND = 'EXTEND',
  COMPRESS = 'COMPRESS',
  TURBO = 'TURBO',
  GLITCH = 'GLITCH'
}

export interface PowerUp {
  id: string;
  type: PowerUpType;
  pos: Vector;
  radius: number;
  rotation: number;
}

export interface ActiveEffect {
  type: PowerUpType;
  endTime: number;
  target: number;
}

export interface Vector {
  x: number;
  y: number;
}

export interface Paddle {
  x: number;
  y: number;
  width: number;
  height: number;
  baseHeight: number;
  color: string;
}

export interface Ball {
  pos: Vector;
  vel: Vector;
  radius: number;
  speed: number;
}

export interface GameState {
  player1Score: number;
  player2Score: number;
  status: GameStatus;
  winner: number | null;
}

export interface NetworkPacket {
  type: 'PADDLE_UPDATE' | 'GAME_STATE' | 'SCORE' | 'POWERUP_SPAWN' | 'EVENT';
  payload: any;
  role: NetworkRole;
}
