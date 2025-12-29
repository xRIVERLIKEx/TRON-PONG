
import React, { useState, useCallback, useEffect, useRef } from 'react';
import GameCanvas from './components/GameCanvas';
import { GameStatus, GameMode, NetworkRole } from './types';
import { getCommentary } from './services/geminiService';
import { soundService } from './services/soundService';
import { multiplayerService } from './services/multiplayerService';
import { RotateCcw, Monitor, Volume2, VolumeX, Zap, Users, ShieldAlert, Globe, Link as LinkIcon, CheckCircle } from 'lucide-react';

const COMMENTARY_COOLDOWN = 8000;

const App: React.FC = () => {
  const [status, setStatus] = useState<GameStatus>(GameStatus.MENU);
  const [mode, setMode] = useState<GameMode>(GameMode.SOLO);
  const [role, setRole] = useState<NetworkRole>(NetworkRole.NONE);
  const [roomCode, setRoomCode] = useState("");
  const [scores, setScores] = useState({ p1: 0, p2: 0 });
  const [winner, setWinner] = useState<number | null>(null);
  const [mcpCommentary, setMcpCommentary] = useState<string>("GREETINGS, PROGRAM.");
  const [isTyping, setIsTyping] = useState(false);
  const [isMusicEnabled, setIsMusicEnabled] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'IDLE' | 'CONNECTING' | 'CONNECTED'>('IDLE');
  
  const statusRef = useRef(status);
  const lastCommentaryTimeRef = useRef<number>(0);

  useEffect(() => { statusRef.current = status; }, [status]);

  const handleScoreUpdate = useCallback((p1: number, p2: number) => {
    setScores({ p1, p2 });
  }, []);

  const handleGameOver = useCallback((winnerId: number) => {
    setWinner(winnerId);
    setStatus(GameStatus.GAME_OVER);
    triggerCommentary("GAME_OVER_WINNER_" + winnerId, true);
  }, []);

  const triggerCommentary = useCallback(async (event: string, bypassThrottle: boolean = false) => {
    const now = Date.now();
    if (!bypassThrottle && (now - lastCommentaryTimeRef.current < COMMENTARY_COOLDOWN)) return;
    lastCommentaryTimeRef.current = now;
    setIsTyping(true);
    const comment = await getCommentary(event, scores.p1, scores.p2);
    setMcpCommentary(comment);
    setIsTyping(false);
  }, [scores]);

  const handleGameEvent = useCallback((event: string) => {
    if (event.includes('SCORED') || event.includes('POWERUP')) triggerCommentary(event);
  }, [triggerCommentary]);

  const toggleMusic = useCallback(() => {
    const newState = soundService.toggleMusic();
    setIsMusicEnabled(newState);
  }, []);

  const initSoloGame = () => {
    setMode(GameMode.SOLO);
    setRole(NetworkRole.NONE);
    multiplayerService.cleanup();
    startGame();
  };

  const initHostMultiplayer = async () => {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    setRoomCode(code);
    setMode(GameMode.MULTIPLAYER);
    setRole(NetworkRole.HOST);
    setConnectionStatus('CONNECTING');
    setStatus(GameStatus.CONNECTING);
    
    try {
      await multiplayerService.init(NetworkRole.HOST, code);
      triggerCommentary("INITIALIZING_GRID_BROADCAST", true);
      
      multiplayerService.onConnect(() => {
        setConnectionStatus('CONNECTED');
        startGame();
        triggerCommentary("SYNC_COMPLETE_SECONDARY_USER_LINKED", true);
      });
    } catch (e) {
      console.error(e);
      setMcpCommentary("CONNECTION_PROTOCOL_FAILURE. RETRY.");
      setStatus(GameStatus.MENU);
    }
  };

  const joinGrid = async (code: string) => {
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;
    
    setRoomCode(cleanCode);
    setMode(GameMode.MULTIPLAYER);
    setRole(NetworkRole.GUEST);
    setConnectionStatus('CONNECTING');
    setStatus(GameStatus.CONNECTING);
    
    try {
      await multiplayerService.init(NetworkRole.GUEST, cleanCode);
      multiplayerService.onConnect(() => {
        setConnectionStatus('CONNECTED');
        startGame();
        triggerCommentary("LINK_ESTABLISHED_GRID_SYNC_ACTIVE", true);
      });
    } catch (e) {
      console.error(e);
      setMcpCommentary("REMOTE_GRID_NOT_FOUND.");
      setStatus(GameStatus.MENU);
    }
  };

  const startGame = useCallback(() => {
    soundService.playLevelStart();
    if (!isMusicEnabled) {
      soundService.startMusic();
      setIsMusicEnabled(true);
    }
    setScores({ p1: 0, p2: 0 });
    setWinner(null);
    setStatus(GameStatus.PLAYING);
  }, [isMusicEnabled]);

  const copyInviteLink = () => {
    const url = window.location.href.split('?')[0];
    navigator.clipboard.writeText(`${url}?grid=${roomCode}`);
    setMcpCommentary("INVITE_LINK_COPIED_TO_BUFFER.");
  };

  // Auto-join if URL has grid param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const grid = params.get('grid');
    if (grid && status === GameStatus.MENU) {
      joinGrid(grid);
    }
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 gap-8 bg-[#00050a] relative font-mono">
      
      <div className="w-full max-w-4xl flex justify-between items-end">
        <div className="flex flex-col">
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-bold tracking-widest text-[#00f2ff] drop-shadow-[0_0_10px_#00f2ff]">TRON PONG</h1>
            <button onClick={toggleMusic} className={`p-2 rounded-full border transition-all ${isMusicEnabled ? 'border-[#00f2ff] text-[#00f2ff] shadow-[0_0_10px_#00f2ff]' : 'border-white/20 text-white/20'}`}>
              {isMusicEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
          </div>
          <p className="text-xs text-[#00f2ff]/60 tracking-[0.3em] mt-1">
            {mode === GameMode.MULTIPLAYER ? `GRID_LINK: ${roomCode} [${role}]` : 'OFFLINE_PROTOCOL_v5.0'}
          </p>
        </div>
        
        <div className="flex gap-12 items-center text-5xl font-bold">
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-[#00f2ff]/50 mb-1">USER 1</span>
            <span className="text-[#00f2ff] drop-shadow-[0_0_8px_#00f2ff]">{scores.p1}</span>
          </div>
          <div className="text-white/20">:</div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-[#ff00f2]/50 mb-1">{mode === GameMode.SOLO ? 'GRID AI' : 'USER 2'}</span>
            <span className="text-[#ff00f2] drop-shadow-[0_0_8px_#ff00f2]">{scores.p2}</span>
          </div>
        </div>
      </div>

      <div className="relative">
        <GameCanvas 
          status={status} mode={mode} role={role}
          onScoreUpdate={handleScoreUpdate}
          onGameOver={handleGameOver}
          onGameEvent={handleGameEvent}
        />

        {status === GameStatus.MENU && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-8 gap-6">
             <h2 className="text-2xl text-[#00f2ff] tracking-[0.5em] animate-pulse">CHOOSE PROTOCOL</h2>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-lg">
                <button onClick={initSoloGame} className="flex flex-col items-center p-6 border-2 border-[#00f2ff]/30 hover:border-[#00f2ff] transition-all bg-black/40 group">
                   <Zap className="w-10 h-10 mb-2 group-hover:scale-110 transition-transform" />
                   <span className="text-lg font-bold">SOLO GRID</span>
                   <span className="text-[10px] opacity-50 uppercase mt-2">v.s. Master Control</span>
                </button>
                <button onClick={initHostMultiplayer} className="flex flex-col items-center p-6 border-2 border-[#ff00f2]/30 hover:border-[#ff00f2] transition-all bg-black/40 group">
                   <Users className="w-10 h-10 mb-2 group-hover:scale-110 transition-transform" />
                   <span className="text-lg font-bold">MULTI GRID</span>
                   <span className="text-[10px] opacity-50 uppercase mt-2">Networked Interface</span>
                </button>
             </div>
             
             <div className="w-full max-w-lg p-4 border border-white/10 bg-white/5 flex gap-2 items-center">
                <Globe className="w-4 h-4 text-white/40" />
                <input 
                  type="text" 
                  placeholder="ENTER GRID CODE..." 
                  className="bg-transparent border-none outline-none text-white w-full text-sm tracking-widest uppercase"
                  onKeyDown={(e) => { if (e.key === 'Enter') joinGrid(e.currentTarget.value.toUpperCase()); }}
                />
             </div>
          </div>
        )}

        {status === GameStatus.CONNECTING && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/95">
             {role === NetworkRole.HOST ? (
               <>
                 <ShieldAlert className="w-12 h-12 text-[#ff00f2] animate-bounce mb-4" />
                 <h2 className="text-xl tracking-widest uppercase">Broadcast Active</h2>
                 <p className="text-6xl font-bold text-[#00f2ff] my-4 tracking-tighter shadow-cyan-500/50 drop-shadow-md">{roomCode}</p>
                 <div className="flex gap-4 mb-6">
                    <button onClick={copyInviteLink} className="flex items-center gap-2 px-4 py-2 bg-[#00f2ff]/10 border border-[#00f2ff]/50 text-[10px] hover:bg-[#00f2ff]/20 transition-all uppercase">
                       <LinkIcon className="w-3 h-3" /> Copy Grid Invite
                    </button>
                 </div>
                 <p className="text-[10px] opacity-40 uppercase max-w-xs text-center animate-pulse">Waiting for secondary program to join the grid...</p>
               </>
             ) : (
               <>
                 <div className="flex items-center gap-4 mb-8">
                    <div className="w-12 h-12 border-4 border-[#00f2ff] border-t-transparent rounded-full animate-spin"></div>
                    <h2 className="text-xl tracking-widest uppercase">Linking to Grid {roomCode}</h2>
                 </div>
                 <p className="text-[10px] opacity-40 uppercase">Synchronizing disk frequencies...</p>
               </>
             )}
             <button onClick={() => setStatus(GameStatus.MENU)} className="mt-12 px-6 py-2 border border-white/20 text-xs hover:border-white transition-all opacity-50">ABORT_PROTOCOL</button>
          </div>
        )}

        {status === GameStatus.GAME_OVER && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md">
            <div className={`p-10 border-4 ${winner === 1 ? 'border-[#00f2ff]' : 'border-[#ff00f2]'} text-center shadow-[0_0_50px_rgba(0,0,0,1)]`}>
              <h2 className={`text-5xl font-bold mb-4 ${winner === 1 ? 'text-[#00f2ff]' : 'text-[#ff00f2]'}`}>
                {winner === 1 ? 'USER 1 VICTORIOUS' : (mode === GameMode.SOLO ? 'GRID PREVAILED' : 'USER 2 VICTORIOUS')}
              </h2>
              <div className="flex gap-4 justify-center">
                <button onClick={initSoloGame} className="flex items-center gap-2 px-8 py-3 bg-white text-black font-bold uppercase hover:bg-[#00f2ff] transition-colors">
                  <RotateCcw className="w-5 h-5" /> RE-INITIALIZE
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="col-span-2 p-4 bg-black/40 border-l-4 border-[#00f2ff] relative">
          <p className="text-xs text-[#00f2ff]/40 font-mono mb-2 flex items-center gap-2 uppercase">
            <Monitor className="w-3 h-3" /> Master Control Program
          </p>
          <div className="text-sm min-h-[3rem] text-[#00f2ff]/90 italic">
            {isTyping ? <span className="animate-pulse">ANALYZING GRID DATA...</span> : <span>&gt; {mcpCommentary}</span>}
          </div>
        </div>
        <div className="hidden md:flex flex-col justify-center items-end text-[10px] text-[#ff00f2]/40 uppercase tracking-[0.2em] p-4 border-r-4 border-[#ff00f2]">
          <div className="flex items-center gap-2">
            Protocol: {mode}
            {connectionStatus === 'CONNECTED' && <CheckCircle className="w-3 h-3 text-[#00f2ff]" />}
          </div>
          <div>Role: {role}</div>
          <div className={connectionStatus === 'CONNECTED' ? 'text-[#00f2ff]' : ''}>Status: {connectionStatus}</div>
        </div>
      </div>
    </div>
  );
};

export default App;
