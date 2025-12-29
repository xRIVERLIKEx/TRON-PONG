
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { 
  CANVAS_WIDTH, 
  CANVAS_HEIGHT, 
  PADDLE_WIDTH, 
  PADDLE_HEIGHT, 
  BALL_RADIUS, 
  COLORS, 
  INITIAL_BALL_SPEED, 
  MAX_BALL_SPEED,
  SPEED_INCREMENT,
  WINNING_SCORE,
  POWERUP_DURATION,
  POWERUP_SPAWN_CHANCE,
  POWERUP_RADIUS
} from '../constants';
import { GameStatus, Ball, Paddle, Vector, PowerUpType, PowerUp, ActiveEffect, NetworkRole, GameMode } from '../types';
import { soundService } from '../services/soundService';
import { multiplayerService } from '../services/multiplayerService';

interface ExtendedBall extends Ball {
  spin: number;
  rotation: number;
  glitchPhase: number;
}

interface Particle {
  pos: Vector;
  vel: Vector;
  life: number;
  color: string;
  size: number;
  rotation: number;
  rotationSpeed: number;
}

interface Props {
  status: GameStatus;
  mode: GameMode;
  role: NetworkRole;
  onScoreUpdate: (p1: number, p2: number) => void;
  onGameOver: (winner: number) => void;
  onGameEvent: (event: string) => void;
}

const GameCanvas: React.FC<Props> = ({ status, mode, role, onScoreUpdate, onGameOver, onGameEvent }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const serveDirectionRef = useRef<number>(1);
  const gridPulseRef = useRef<number>(0);
  
  const isHost = mode === GameMode.SOLO || role === NetworkRole.HOST;

  const ballRef = useRef<ExtendedBall>({
    pos: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
    vel: { x: INITIAL_BALL_SPEED, y: 0 },
    radius: BALL_RADIUS,
    speed: INITIAL_BALL_SPEED,
    spin: 0,
    rotation: 0,
    glitchPhase: 0
  });

  const p1Ref = useRef<Paddle>({
    x: 20,
    y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
    baseHeight: PADDLE_HEIGHT,
    color: COLORS.CYAN
  });

  const p2Ref = useRef<Paddle>({
    x: CANVAS_WIDTH - 20 - PADDLE_WIDTH,
    y: CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
    baseHeight: PADDLE_HEIGHT,
    color: COLORS.PINK
  });

  const trailRef = useRef<{x: number, y: number}[]>([]);
  const MAX_TRAIL_LENGTH = 20;
  const particlesRef = useRef<Particle[]>([]);
  const powerUpsRef = useRef<PowerUp[]>([]);
  const activeEffectsRef = useRef<ActiveEffect[]>([]);
  const isServingRef = useRef<boolean>(false);

  const topWallFlashRef = useRef<number>(0);
  const bottomWallFlashRef = useRef<number>(0);
  const p1FlashRef = useRef<number>(0);
  const p2FlashRef = useRef<number>(0);
  const p1DyRef = useRef<number>(0);
  const p2DyRef = useRef<number>(0);

  const scoresRef = useRef({ p1: 0, p2: 0 });
  const keysRef = useRef<Set<string>>(new Set());

  // Handle Network Packets
  useEffect(() => {
    if (mode === GameMode.MULTIPLAYER) {
      multiplayerService.onMessage((packet) => {
        if (packet.type === 'PADDLE_UPDATE') {
          if (role === NetworkRole.HOST) p2Ref.current.y = packet.payload.y;
          else p1Ref.current.y = packet.payload.y;
        } else if (packet.type === 'GAME_STATE') {
          if (role === NetworkRole.GUEST) {
            ballRef.current.pos = packet.payload.ballPos;
            ballRef.current.rotation = packet.payload.ballRotation;
            p2Ref.current.height = packet.payload.p2Height;
            p1Ref.current.height = packet.payload.p1Height;
            powerUpsRef.current = packet.payload.powerUps;
          }
        } else if (packet.type === 'SCORE') {
          scoresRef.current = packet.payload;
          onScoreUpdate(scoresRef.current.p1, scoresRef.current.p2);
          soundService.playExplosion();
        } else if (packet.type === 'EVENT') {
          if (packet.payload.name === 'START_COUNTDOWN') {
            triggerLocalCountdown(packet.payload.dir);
          }
        }
      });
    }
  }, [mode, role, onScoreUpdate]);

  useEffect(() => {
    const handlePulse = () => { gridPulseRef.current = 1.0; };
    window.addEventListener('grid-pulse', handlePulse);
    return () => window.removeEventListener('grid-pulse', handlePulse);
  }, []);

  const createExplosion = (x: number, y: number, color: string, count: number = 15) => {
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        pos: { x, y },
        vel: { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10 },
        life: 1.0,
        color: color,
        size: Math.random() * 5 + 2,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.2
      });
    }
  };

  const spawnPowerUp = useCallback(() => {
    if (!isHost) return;
    if (powerUpsRef.current.length >= 1) return;
    const types = [PowerUpType.EXTEND, PowerUpType.COMPRESS, PowerUpType.TURBO, PowerUpType.GLITCH];
    const type = types[Math.floor(Math.random() * types.length)];
    const margin = 100;
    powerUpsRef.current.push({
      id: Math.random().toString(36),
      type,
      pos: {
        x: margin + Math.random() * (CANVAS_WIDTH - margin * 2),
        y: margin + Math.random() * (CANVAS_HEIGHT - margin * 2)
      },
      radius: POWERUP_RADIUS,
      rotation: 0
    });
  }, [isHost]);

  const triggerLocalCountdown = (direction: number) => {
    isServingRef.current = true;
    serveDirectionRef.current = direction;
    ballRef.current.pos = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    ballRef.current.vel = { x: 0, y: 0 };
    trailRef.current = [];
    
    let timer = 3;
    setCountdown(timer);
    
    const interval = setInterval(() => {
      timer -= 1;
      if (timer > 0) {
        setCountdown(timer);
        soundService.playWallHit();
      } else {
        clearInterval(interval);
        setCountdown(null);
        isServingRef.current = false;
        if (isHost) {
          ballRef.current.speed = INITIAL_BALL_SPEED;
          ballRef.current.vel = { x: direction * INITIAL_BALL_SPEED, y: (Math.random() - 0.5) * 4 };
        }
        soundService.playPaddleHit();
      }
    }, 800);
  };

  const startCountdown = useCallback((direction: number) => {
    if (mode === GameMode.MULTIPLAYER && role === NetworkRole.HOST) {
       multiplayerService.send('EVENT', { name: 'START_COUNTDOWN', dir: direction });
    }
    triggerLocalCountdown(direction);
  }, [mode, role]);

  useEffect(() => {
    if (status === GameStatus.PLAYING && scoresRef.current.p1 === 0 && scoresRef.current.p2 === 0) {
      startCountdown(1);
    }
  }, [status, startCountdown]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keysRef.current.add(e.code);
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.code);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const update = useCallback(() => {
    if (status !== GameStatus.PLAYING) return;
    const now = Date.now();

    // Decay flashes
    if (p1FlashRef.current > 0) p1FlashRef.current -= 0.04;
    if (p2FlashRef.current > 0) p2FlashRef.current -= 0.04;
    if (topWallFlashRef.current > 0) topWallFlashRef.current -= 0.04;
    if (bottomWallFlashRef.current > 0) bottomWallFlashRef.current -= 0.04;
    if (gridPulseRef.current > 0) gridPulseRef.current -= 0.05;

    // Particles
    particlesRef.current.forEach(p => {
      p.pos.x += p.vel.x; p.pos.y += p.vel.y; p.rotation += p.rotationSpeed; p.life -= 0.02;
    });
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);

    // --- Paddle Movement ---
    const moveSpeed = 8;
    let moveDy = 0;
    if (keysRef.current.has('KeyW') || keysRef.current.has('ArrowUp')) moveDy -= moveSpeed;
    if (keysRef.current.has('KeyS') || keysRef.current.has('ArrowDown')) moveDy += moveSpeed;

    if (mode === GameMode.SOLO || role === NetworkRole.HOST) {
      const oldY = p1Ref.current.y;
      p1Ref.current.y = Math.max(0, Math.min(CANVAS_HEIGHT - p1Ref.current.height, p1Ref.current.y + moveDy));
      p1DyRef.current = p1Ref.current.y - oldY;
      if (mode === GameMode.MULTIPLAYER) multiplayerService.send('PADDLE_UPDATE', { y: p1Ref.current.y });
    } else {
      const oldY = p2Ref.current.y;
      p2Ref.current.y = Math.max(0, Math.min(CANVAS_HEIGHT - p2Ref.current.height, p2Ref.current.y + moveDy));
      p2DyRef.current = p2Ref.current.y - oldY;
      multiplayerService.send('PADDLE_UPDATE', { y: p2Ref.current.y });
    }

    // AI Logic (Only if Solo)
    if (mode === GameMode.SOLO) {
      const aiTarget = ballRef.current.pos.y - p2Ref.current.height / 2;
      const oldP2Y = p2Ref.current.y;
      p2Ref.current.y += (aiTarget - p2Ref.current.y) * 0.075;
      p2Ref.current.y = Math.max(0, Math.min(CANVAS_HEIGHT - p2Ref.current.height, p2Ref.current.y));
      p2DyRef.current = p2Ref.current.y - oldP2Y;
    }

    // --- Host Logic: Physics and Syncing ---
    if (isHost) {
      if (Math.random() < POWERUP_SPAWN_CHANCE) spawnPowerUp();
      activeEffectsRef.current = activeEffectsRef.current.filter(eff => eff.endTime > now);
      
      const p1Extend = activeEffectsRef.current.some(e => e.type === PowerUpType.EXTEND && e.target === 1);
      const p1Compress = activeEffectsRef.current.some(e => e.type === PowerUpType.COMPRESS && e.target === 1);
      const p2Extend = activeEffectsRef.current.some(e => e.type === PowerUpType.EXTEND && e.target === 2);
      const p2Compress = activeEffectsRef.current.some(e => e.type === PowerUpType.COMPRESS && e.target === 2);

      const targetH1 = p1Extend ? PADDLE_HEIGHT * 1.5 : (p1Compress ? PADDLE_HEIGHT * 0.6 : PADDLE_HEIGHT);
      const targetH2 = p2Extend ? PADDLE_HEIGHT * 1.5 : (p2Compress ? PADDLE_HEIGHT * 0.6 : PADDLE_HEIGHT);

      p1Ref.current.height += (targetH1 - p1Ref.current.height) * 0.1;
      p2Ref.current.height += (targetH2 - p2Ref.current.height) * 0.1;

      if (!isServingRef.current) {
        const ball = ballRef.current;
        const isGlitching = activeEffectsRef.current.some(e => e.type === PowerUpType.GLITCH);
        const isTurbo = activeEffectsRef.current.some(e => e.type === PowerUpType.TURBO);
        const currentBallSpeed = isTurbo ? ball.speed * 1.5 : ball.speed;

        ball.pos.x += (ball.vel.x / ball.speed) * currentBallSpeed;
        ball.pos.y += (ball.vel.y / ball.speed) * currentBallSpeed;
        if (isGlitching) { ball.glitchPhase += 0.2; ball.pos.y += Math.sin(ball.glitchPhase) * 6; }
        ball.rotation += ball.spin * 0.05;

        // Collision Logic (Walls)
        if (ball.pos.y - ball.radius < 0) { ball.pos.y = ball.radius; ball.vel.y = Math.abs(ball.vel.y); topWallFlashRef.current = 1.0; soundService.playWallHit(); }
        else if (ball.pos.y + ball.radius > CANVAS_HEIGHT) { ball.pos.y = CANVAS_HEIGHT - ball.radius; ball.vel.y = -Math.abs(ball.vel.y); bottomWallFlashRef.current = 1.0; soundService.playWallHit(); }

        // Collision Logic (Paddles)
        const checkCollision = (p: Paddle) => ball.pos.x + ball.radius > p.x && ball.pos.x - ball.radius < p.x + p.width && ball.pos.y + ball.radius > p.y && ball.pos.y - ball.radius < p.y + p.height;
        
        if (checkCollision(p1Ref.current) && ball.vel.x < 0) {
          p1FlashRef.current = 1.0; ball.pos.x = p1Ref.current.x + p1Ref.current.width + ball.radius;
          const cp = (ball.pos.y - (p1Ref.current.y + p1Ref.current.height / 2)) / (p1Ref.current.height / 2);
          const angle = cp * (Math.PI / 4);
          ball.speed = Math.min(MAX_BALL_SPEED, ball.speed + SPEED_INCREMENT);
          ball.vel.x = Math.cos(angle) * ball.speed; ball.vel.y = Math.sin(angle) * ball.speed;
          soundService.playPaddleHit();
        }
        if (checkCollision(p2Ref.current) && ball.vel.x > 0) {
          p2FlashRef.current = 1.0; ball.pos.x = p2Ref.current.x - ball.radius;
          const cp = (ball.pos.y - (p2Ref.current.y + p2Ref.current.height / 2)) / (p2Ref.current.height / 2);
          const angle = cp * (Math.PI / 4);
          ball.speed = Math.min(MAX_BALL_SPEED, ball.speed + SPEED_INCREMENT);
          ball.vel.x = -Math.cos(angle) * ball.speed; ball.vel.y = Math.sin(angle) * ball.speed;
          soundService.playPaddleHit();
        }

        // Scoring
        if (ball.pos.x < -20) {
          scoresRef.current.p2++; if (mode === GameMode.MULTIPLAYER) multiplayerService.send('SCORE', scoresRef.current);
          onScoreUpdate(scoresRef.current.p1, scoresRef.current.p2); soundService.playExplosion();
          if (scoresRef.current.p2 >= WINNING_SCORE) onGameOver(2); else startCountdown(1);
        } else if (ball.pos.x > CANVAS_WIDTH + 20) {
          scoresRef.current.p1++; if (mode === GameMode.MULTIPLAYER) multiplayerService.send('SCORE', scoresRef.current);
          onScoreUpdate(scoresRef.current.p1, scoresRef.current.p2); soundService.playExplosion();
          if (scoresRef.current.p1 >= WINNING_SCORE) onGameOver(1); else startCountdown(-1);
        }
      }

      // Broadcast State
      if (mode === GameMode.MULTIPLAYER) {
        multiplayerService.send('GAME_STATE', {
          ballPos: ballRef.current.pos,
          ballRotation: ballRef.current.rotation,
          p1Height: p1Ref.current.height,
          p2Height: p2Ref.current.height,
          powerUps: powerUpsRef.current
        });
      }
    }

    // Always update trails and local particles
    trailRef.current.unshift({ ...ballRef.current.pos });
    if (trailRef.current.length > MAX_TRAIL_LENGTH) trailRef.current.pop();
  }, [status, isHost, mode, role, onScoreUpdate, onGameOver, startCountdown, spawnPowerUp]);

  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = COLORS.BACKGROUND;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const gridOpacity = 0.1 + gridPulseRef.current * 0.15;
    ctx.strokeStyle = `rgba(0, 242, 255, ${gridOpacity})`;
    ctx.lineWidth = 1 + gridPulseRef.current * 2;
    for (let i = 0; i < CANVAS_WIDTH; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, CANVAS_HEIGHT); ctx.stroke(); }
    for (let j = 0; j < CANVAS_HEIGHT; j += 40) { ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(CANVAS_WIDTH, j); ctx.stroke(); }

    trailRef.current.forEach((p, i) => {
      ctx.globalAlpha = (1 - i / MAX_TRAIL_LENGTH) * 0.5;
      ctx.fillStyle = COLORS.CYAN;
      ctx.beginPath(); ctx.arc(p.x, p.y, BALL_RADIUS * (1 - i / MAX_TRAIL_LENGTH), 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    powerUpsRef.current.forEach(pu => {
      ctx.save(); ctx.translate(pu.pos.x, pu.pos.y); pu.rotation += 0.05; ctx.rotate(pu.rotation);
      ctx.strokeStyle = COLORS.YELLOW; ctx.lineWidth = 2; ctx.strokeRect(-10, -10, 20, 20); ctx.restore();
    });

    particlesRef.current.forEach(p => {
      ctx.save(); ctx.globalAlpha = p.life; ctx.translate(p.pos.x, p.pos.y); ctx.rotate(p.rotation);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size); ctx.restore();
    });
    ctx.globalAlpha = 1;

    // Ball
    if (!isServingRef.current) {
      const ball = ballRef.current;
      ctx.save(); ctx.translate(ball.pos.x, ball.pos.y); ctx.rotate(ball.rotation);
      ctx.fillStyle = '#fff'; ctx.shadowBlur = 20; ctx.shadowColor = COLORS.CYAN;
      ctx.beginPath(); ctx.arc(0, 0, ball.radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }

    // Paddles
    const drawPad = (p: Paddle, f: number) => {
      ctx.save(); ctx.translate(p.x + p.width/2, p.y + p.height/2); ctx.scale(1+f*0.2, 1+f*0.1);
      ctx.fillStyle = p.color; ctx.shadowBlur = 20+f*40; ctx.shadowColor = p.color;
      ctx.fillRect(-p.width/2, -p.height/2, p.width, p.height); ctx.restore();
    };
    drawPad(p1Ref.current, p1FlashRef.current);
    drawPad(p2Ref.current, p2FlashRef.current);

    if (countdown !== null) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 80px Orbitron'; ctx.textAlign = 'center'; ctx.fillText(countdown.toString(), CANVAS_WIDTH/2, CANVAS_HEIGHT/2);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let aid: number;
    const loop = () => { update(); draw(ctx); aid = requestAnimationFrame(loop); };
    loop(); return () => cancelAnimationFrame(aid);
  }, [update, draw]);

  return (
    <div className="relative border-4 border-[#00f2ff] shadow-[0_0_20px_rgba(0,242,255,0.5)] bg-black overflow-hidden">
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="block" />
      <div className="scanline"></div>
    </div>
  );
};

export default GameCanvas;
