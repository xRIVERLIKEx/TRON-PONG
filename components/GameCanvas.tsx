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

interface Shockwave {
  pos: Vector;
  radius: number;
  maxRadius: number;
  life: number;
}

interface PopupText {
  pos: Vector;
  text: string;
  life: number;
  color: string;
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
  const MAX_TRAIL_LENGTH = 18;
  const particlesRef = useRef<Particle[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const popupsRef = useRef<PopupText[]>([]);
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

  const createExplosion = (x: number, y: number, color: string, count: number = 20, force: number = 6) => {
    // Add Shockwave
    shockwavesRef.current.push({
      pos: { x, y },
      radius: 0,
      maxRadius: count * 2,
      life: 1.0
    });

    // Add Debris Particles
    for (let i = 0; i < count; i++) {
      particlesRef.current.push({
        pos: { x, y },
        vel: { 
          x: (Math.random() - 0.5) * force * 2.5, 
          y: (Math.random() - 0.5) * force * 2.5 
        },
        life: 1.0,
        color: color,
        size: Math.random() * 5 + 2,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.4
      });
    }
  };

  const createPopup = (x: number, y: number, text: string, color: string) => {
    popupsRef.current.push({
      pos: { x, y },
      text,
      life: 1.0,
      color
    });
  };

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
            ballRef.current.spin = packet.payload.ballSpin;
            p2Ref.current.height = packet.payload.p2Height;
            p1Ref.current.height = packet.payload.p1Height;
            powerUpsRef.current = packet.payload.powerUps;
            topWallFlashRef.current = packet.payload.topFlash;
            bottomWallFlashRef.current = packet.payload.bottomFlash;
            p1FlashRef.current = packet.payload.p1Flash;
            p2FlashRef.current = packet.payload.p2Flash;
          }
        } else if (packet.type === 'SCORE') {
          scoresRef.current = packet.payload;
          onScoreUpdate(scoresRef.current.p1, scoresRef.current.p2);
          soundService.playExplosion();
          createExplosion(CANVAS_WIDTH/2, CANVAS_HEIGHT/2, COLORS.YELLOW, 50, 12);
        } else if (packet.type === 'EVENT') {
          if (packet.payload.name === 'START_COUNTDOWN') triggerLocalCountdown(packet.payload.dir);
          if (packet.payload.name === 'EXPLOSION') createExplosion(packet.payload.x, packet.payload.y, packet.payload.color);
          if (packet.payload.name === 'POPUP') createPopup(packet.payload.x, packet.payload.y, packet.payload.text, packet.payload.color);
        }
      });
    }
  }, [mode, role, onScoreUpdate]);

  useEffect(() => {
    const handlePulse = () => { gridPulseRef.current = 1.0; };
    window.addEventListener('grid-pulse', handlePulse);
    return () => window.removeEventListener('grid-pulse', handlePulse);
  }, []);

  const spawnPowerUp = useCallback(() => {
    if (!isHost) return;
    if (powerUpsRef.current.length >= 2) return;
    const types = [PowerUpType.EXTEND, PowerUpType.COMPRESS, PowerUpType.TURBO, PowerUpType.GLITCH];
    const type = types[Math.floor(Math.random() * types.length)];
    powerUpsRef.current.push({
      id: Math.random().toString(36),
      type,
      pos: {
        x: 150 + Math.random() * (CANVAS_WIDTH - 300),
        y: 100 + Math.random() * (CANVAS_HEIGHT - 200)
      },
      radius: POWERUP_RADIUS,
      rotation: 0
    });
    onGameEvent(`POWERUP_SPAWNED_${type}`);
  }, [isHost, onGameEvent]);

  const triggerLocalCountdown = (direction: number) => {
    isServingRef.current = true;
    serveDirectionRef.current = direction;
    ballRef.current.pos = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
    ballRef.current.vel = { x: 0, y: 0 };
    ballRef.current.spin = 0;
    ballRef.current.rotation = 0;
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

    // Visual Decay
    if (p1FlashRef.current > 0) p1FlashRef.current -= 0.04;
    if (p2FlashRef.current > 0) p2FlashRef.current -= 0.04;
    if (topWallFlashRef.current > 0) topWallFlashRef.current -= 0.04;
    if (bottomWallFlashRef.current > 0) bottomWallFlashRef.current -= 0.04;
    if (gridPulseRef.current > 0) gridPulseRef.current -= 0.04;

    // Entity Life Cycles
    particlesRef.current.forEach(p => {
      p.pos.x += p.vel.x; p.pos.y += p.vel.y; 
      p.vel.x *= 0.98; p.vel.y *= 0.98; // Friction
      p.rotation += p.rotationSpeed; p.life -= 0.02;
    });
    particlesRef.current = particlesRef.current.filter(p => p.life > 0);

    shockwavesRef.current.forEach(s => {
      s.radius += 4;
      s.life -= 0.03;
    });
    shockwavesRef.current = shockwavesRef.current.filter(s => s.life > 0);

    popupsRef.current.forEach(p => {
      p.pos.y -= 1;
      p.life -= 0.02;
    });
    popupsRef.current = popupsRef.current.filter(p => p.life > 0);

    // Paddle Movement
    const moveSpeed = 10;
    let moveDy = 0;
    if (keysRef.current.has('KeyW') || keysRef.current.has('ArrowUp')) moveDy -= moveSpeed;
    if (keysRef.current.has('KeyS') || keysRef.current.has('ArrowDown')) moveDy += moveSpeed;

    const updateLocalPaddle = (p: React.MutableRefObject<Paddle>, dyRef: React.MutableRefObject<number>, dy: number) => {
      const oldY = p.current.y;
      p.current.y = Math.max(0, Math.min(CANVAS_HEIGHT - p.current.height, p.current.y + dy));
      dyRef.current = p.current.y - oldY;
    };

    if (mode === GameMode.SOLO || role === NetworkRole.HOST) {
      updateLocalPaddle(p1Ref, p1DyRef, moveDy);
      if (mode === GameMode.MULTIPLAYER) multiplayerService.send('PADDLE_UPDATE', { y: p1Ref.current.y });
    } else {
      updateLocalPaddle(p2Ref, p2DyRef, moveDy);
      multiplayerService.send('PADDLE_UPDATE', { y: p2Ref.current.y });
    }

    if (mode === GameMode.SOLO) {
      const aiTarget = ballRef.current.pos.y - p2Ref.current.height / 2;
      const oldP2Y = p2Ref.current.y;
      p2Ref.current.y += (aiTarget - p2Ref.current.y) * 0.1;
      p2Ref.current.y = Math.max(0, Math.min(CANVAS_HEIGHT - p2Ref.current.height, p2Ref.current.y));
      p2DyRef.current = p2Ref.current.y - oldP2Y;
    }

    if (isHost) {
      if (Math.random() < POWERUP_SPAWN_CHANCE) spawnPowerUp();
      activeEffectsRef.current = activeEffectsRef.current.filter(eff => eff.endTime > now);
      
      const getEffect = (target: number, type: PowerUpType) => activeEffectsRef.current.some(e => e.type === type && e.target === target);

      const targetH1 = getEffect(1, PowerUpType.EXTEND) ? PADDLE_HEIGHT * 1.8 : (getEffect(1, PowerUpType.COMPRESS) ? PADDLE_HEIGHT * 0.4 : PADDLE_HEIGHT);
      const targetH2 = getEffect(2, PowerUpType.EXTEND) ? PADDLE_HEIGHT * 1.8 : (getEffect(2, PowerUpType.COMPRESS) ? PADDLE_HEIGHT * 0.4 : PADDLE_HEIGHT);
      p1Ref.current.height += (targetH1 - p1Ref.current.height) * 0.1;
      p2Ref.current.height += (targetH2 - p2Ref.current.height) * 0.1;

      if (!isServingRef.current) {
        const ball = ballRef.current;
        const isGlitching = activeEffectsRef.current.some(e => e.type === PowerUpType.GLITCH);
        const isTurbo = activeEffectsRef.current.some(e => e.type === PowerUpType.TURBO);
        const currentBallSpeed = isTurbo ? ball.speed * 1.6 : ball.speed;

        // Physics with enhanced spin curve
        ball.pos.x += (ball.vel.x / ball.speed) * currentBallSpeed;
        ball.pos.y += (ball.vel.y / ball.speed) * currentBallSpeed + (ball.spin * 0.25); 
        ball.rotation += (0.15 + (ball.spin * 0.1)) * (currentBallSpeed / ball.speed);
        ball.spin *= 0.992; // Slight decay

        if (isGlitching) { 
          ball.glitchPhase += 0.4; 
          ball.pos.y += Math.sin(ball.glitchPhase * 2.5) * 12;
          if (Math.random() > 0.94) ball.pos.x += (Math.random() - 0.5) * 25; 
        }

        // Walls
        if (ball.pos.y - ball.radius < 0) { 
          ball.pos.y = ball.radius; ball.vel.y = Math.abs(ball.vel.y); 
          topWallFlashRef.current = 1.0; soundService.playWallHit();
          createExplosion(ball.pos.x, 0, COLORS.CYAN, 8, 3);
        } else if (ball.pos.y + ball.radius > CANVAS_HEIGHT) { 
          ball.pos.y = CANVAS_HEIGHT - ball.radius; ball.vel.y = -Math.abs(ball.vel.y); 
          bottomWallFlashRef.current = 1.0; soundService.playWallHit();
          createExplosion(ball.pos.x, CANVAS_HEIGHT, COLORS.CYAN, 8, 3);
        }

        // Paddle Collision Helper
        const rectCircleColliding = (rx: number, ry: number, rw: number, rh: number, cx: number, cy: number, cr: number) => {
          const testX = cx < rx ? rx : (cx > rx + rw ? rx + rw : cx);
          const testY = cy < ry ? ry : (cy > ry + rh ? ry + rh : cy);
          const distX = cx - testX; const distY = cy - testY;
          return (distX * distX + distY * distY) <= (cr * cr);
        };

        if (rectCircleColliding(p1Ref.current.x, p1Ref.current.y, p1Ref.current.width, p1Ref.current.height, ball.pos.x, ball.pos.y, ball.radius) && ball.vel.x < 0) {
          p1FlashRef.current = 1.0; ball.pos.x = p1Ref.current.x + p1Ref.current.width + ball.radius;
          const cp = (ball.pos.y - (p1Ref.current.y + p1Ref.current.height / 2)) / (p1Ref.current.height / 2);
          const angle = cp * (Math.PI / 3);
          ball.speed = Math.min(MAX_BALL_SPEED, ball.speed + SPEED_INCREMENT);
          ball.vel.x = Math.cos(angle) * ball.speed; ball.vel.y = Math.sin(angle) * ball.speed;
          ball.spin = p1DyRef.current * 1.8; 
          soundService.playPaddleHit();
          createExplosion(ball.pos.x, ball.pos.y, COLORS.CYAN, 15, 5);
        }
        if (rectCircleColliding(p2Ref.current.x, p2Ref.current.y, p2Ref.current.width, p2Ref.current.height, ball.pos.x, ball.pos.y, ball.radius) && ball.vel.x > 0) {
          p2FlashRef.current = 1.0; ball.pos.x = p2Ref.current.x - ball.radius;
          const cp = (ball.pos.y - (p2Ref.current.y + p2Ref.current.height / 2)) / (p2Ref.current.height / 2);
          const angle = cp * (Math.PI / 3);
          ball.speed = Math.min(MAX_BALL_SPEED, ball.speed + SPEED_INCREMENT);
          ball.vel.x = -Math.cos(angle) * ball.speed; ball.vel.y = Math.sin(angle) * ball.speed;
          ball.spin = p2DyRef.current * 1.8;
          soundService.playPaddleHit();
          createExplosion(ball.pos.x, ball.pos.y, COLORS.PINK, 15, 5);
        }

        // PowerUps Collection
        powerUpsRef.current = powerUpsRef.current.filter(pu => {
          const dx = pu.pos.x - ball.pos.x; const dy = pu.pos.y - ball.pos.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < pu.radius + ball.radius) {
            const target = ball.vel.x > 0 ? 1 : 2;
            activeEffectsRef.current.push({ type: pu.type, target, endTime: now + POWERUP_DURATION });
            soundService.playPowerUp();
            createExplosion(pu.pos.x, pu.pos.y, COLORS.YELLOW, 30, 8);
            createPopup(pu.pos.x, pu.pos.y - 20, pu.type, COLORS.YELLOW);
            onGameEvent(`COLLECTED_${pu.type}_TARGET_${target}`);
            if (mode === GameMode.MULTIPLAYER) {
               multiplayerService.send('EVENT', { name: 'POPUP', x: pu.pos.x, y: pu.pos.y-20, text: pu.type, color: COLORS.YELLOW });
               multiplayerService.send('EVENT', { name: 'EXPLOSION', x: pu.pos.x, y: pu.pos.y, color: COLORS.YELLOW });
            }
            return false;
          }
          return true;
        });

        // Scoring
        if (ball.pos.x < -40) {
          scoresRef.current.p2++; if (mode === GameMode.MULTIPLAYER) multiplayerService.send('SCORE', scoresRef.current);
          onScoreUpdate(scoresRef.current.p1, scoresRef.current.p2); soundService.playExplosion();
          createExplosion(0, ball.pos.y, COLORS.PINK, 60, 15);
          if (scoresRef.current.p2 >= WINNING_SCORE) onGameOver(2); else startCountdown(1);
        } else if (ball.pos.x > CANVAS_WIDTH + 40) {
          scoresRef.current.p1++; if (mode === GameMode.MULTIPLAYER) multiplayerService.send('SCORE', scoresRef.current);
          onScoreUpdate(scoresRef.current.p1, scoresRef.current.p2); soundService.playExplosion();
          createExplosion(CANVAS_WIDTH, ball.pos.y, COLORS.CYAN, 60, 15);
          if (scoresRef.current.p1 >= WINNING_SCORE) onGameOver(1); else startCountdown(-1);
        }
      }

      if (mode === GameMode.MULTIPLAYER) {
        multiplayerService.send('GAME_STATE', {
          ballPos: ballRef.current.pos, ballRotation: ballRef.current.rotation, ballSpin: ballRef.current.spin,
          p1Height: p1Ref.current.height, p2Height: p2Ref.current.height,
          powerUps: powerUpsRef.current, p1Flash: p1FlashRef.current, p2Flash: p2FlashRef.current,
          topFlash: topWallFlashRef.current, bottomFlash: bottomWallFlashRef.current
        });
      }
    }

    trailRef.current.unshift({ ...ballRef.current.pos });
    if (trailRef.current.length > MAX_TRAIL_LENGTH) trailRef.current.pop();
  }, [status, isHost, mode, role, onScoreUpdate, onGameOver, startCountdown, spawnPowerUp, onGameEvent]);

  const draw = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = COLORS.BACKGROUND;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Background Grid
    const gridOpacity = 0.04 + gridPulseRef.current * 0.12;
    ctx.strokeStyle = `rgba(0, 242, 255, ${gridOpacity})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < CANVAS_WIDTH; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, CANVAS_HEIGHT); ctx.stroke(); }
    for (let j = 0; j < CANVAS_HEIGHT; j += 40) { ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(CANVAS_WIDTH, j); ctx.stroke(); }

    // Shockwaves
    shockwavesRef.current.forEach(s => {
      ctx.beginPath(); ctx.arc(s.pos.x, s.pos.y, s.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${s.life * 0.5})`;
      ctx.lineWidth = 2; ctx.stroke();
    });

    // Wall Glows
    const drawWall = (y: number, f: number) => {
      ctx.shadowBlur = 10 + f * 40; ctx.shadowColor = COLORS.CYAN;
      ctx.strokeStyle = `rgba(0, 242, 255, ${0.4 + f * 0.6})`;
      ctx.lineWidth = 2 + f * 6; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_WIDTH, y); ctx.stroke();
      ctx.shadowBlur = 0;
    };
    drawWall(0, topWallFlashRef.current);
    drawWall(CANVAS_HEIGHT, bottomWallFlashRef.current);

    // PowerUps
    powerUpsRef.current.forEach(pu => {
      ctx.save(); ctx.translate(pu.pos.x, pu.pos.y); pu.rotation += 0.05; ctx.rotate(pu.rotation);
      ctx.strokeStyle = COLORS.YELLOW; ctx.lineWidth = 2; ctx.shadowBlur = 20; ctx.shadowColor = COLORS.YELLOW;
      ctx.strokeRect(-12, -12, 24, 24); ctx.fillStyle = 'rgba(255, 255, 0, 0.2)'; ctx.fillRect(-12, -12, 24, 24); 
      // Core
      ctx.fillStyle = COLORS.YELLOW; ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    });

    // Ball Trail
    trailRef.current.forEach((p, i) => {
      const alpha = (1 - i / MAX_TRAIL_LENGTH) * 0.6;
      ctx.fillStyle = `rgba(0, 242, 255, ${alpha})`;
      const size = BALL_RADIUS * (1 - i / MAX_TRAIL_LENGTH);
      ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
    });

    // Debris Particles
    particlesRef.current.forEach(p => {
      ctx.save(); ctx.globalAlpha = p.life; ctx.translate(p.pos.x, p.pos.y); ctx.rotate(p.rotation);
      ctx.fillStyle = p.color; ctx.shadowBlur = 5; ctx.shadowColor = p.color;
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size); ctx.restore();
    });
    ctx.globalAlpha = 1;

    // Ball
    if (!isServingRef.current) {
      const ball = ballRef.current;
      ctx.save(); ctx.translate(ball.pos.x, ball.pos.y); ctx.rotate(ball.rotation);
      ctx.fillStyle = '#fff'; ctx.shadowBlur = 25; ctx.shadowColor = COLORS.CYAN;
      ctx.fillRect(-ball.radius, -ball.radius, ball.radius*2, ball.radius*2); 
      // Internal Glow
      ctx.strokeStyle = COLORS.CYAN; ctx.lineWidth = 2; ctx.strokeRect(-ball.radius+1, -ball.radius+1, ball.radius*2-2, ball.radius*2-2);
      ctx.restore();
    }

    // Paddles
    const drawPad = (p: Paddle, f: number, side: 'L'|'R') => {
      const active = activeEffectsRef.current.some(e => e.target === (side === 'L' ? 1 : 2));
      const pulse = active ? (Math.sin(Date.now() / 100) * 0.2 + 1.1) : 1.0;
      
      ctx.save(); ctx.translate(p.x + p.width/2, p.y + p.height/2); 
      ctx.scale((1+f*0.4) * pulse, (1+f*0.2) * pulse);
      ctx.fillStyle = p.color; ctx.shadowBlur = (active ? 40 : 15) + f * 40; ctx.shadowColor = p.color;
      ctx.fillRect(-p.width/2, -p.height/2, p.width, p.height);
      // Details
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(-p.width/2 + 2, -p.height/2 + 2, p.width - 4, p.height - 4);
      ctx.restore();
    };
    drawPad(p1Ref.current, p1FlashRef.current, 'L');
    drawPad(p2Ref.current, p2FlashRef.current, 'R');

    // Popups
    popupsRef.current.forEach(p => {
      ctx.save(); ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.font = 'bold 12px Orbitron'; ctx.textAlign = 'center';
      ctx.fillText(p.text, p.pos.x, p.pos.y); ctx.restore();
    });

    if (countdown !== null) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 110px Orbitron'; ctx.textAlign = 'center'; ctx.shadowBlur = 30; ctx.shadowColor = '#fff';
      ctx.fillText(countdown.toString(), CANVAS_WIDTH/2, CANVAS_HEIGHT/2 + 40); ctx.shadowBlur = 0;
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
    <div className="relative border-4 border-[#00f2ff] shadow-[0_0_40px_rgba(0,242,255,0.4)] bg-black overflow-hidden">
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="block" />
      <div className="scanline"></div>
    </div>
  );
};

export default GameCanvas;