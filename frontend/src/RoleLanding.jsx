import React, { useState, useRef, useEffect } from 'react';

/* ── WebGL Aurora Canvas ─────────────────────────────────────────── */
const VS = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FS = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
varying vec2 v_texCoord;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1  = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m;
  m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.55;
  float frequency = 1.0;
  for (int i = 0; i < 5; i++) {
    total += amplitude * snoise(p * frequency);
    frequency *= 2.08;
    amplitude *= 0.48;
  }
  return total;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 st = uv;
  st.x *= aspect;

  vec2 mouseOffset = (u_mouse / u_resolution - 0.5) * 0.12;
  float t = u_time * 0.20;

  vec2 q = vec2(fbm(st * 1.5 + vec2(t * 0.3, -t * 0.12) + mouseOffset),
                fbm(st * 1.3 - vec2(-t * 0.2, t * 0.18) - mouseOffset));

  vec2 r = vec2(fbm(st * 1.9 + 1.2 * q + vec2(t * 0.15, t * 0.1)),
                fbm(st * 1.7 + 1.1 * q - vec2(t * 0.1, -t * 0.2)));

  float mist = fbm(st * 1.4 + 2.5 * r + vec2(0.0, -t * 0.25));
  mist = smoothstep(-0.15, 0.85, mist);

  float verticalMask = smoothstep(0.95, 0.18, uv.y);
  float baseDensity = smoothstep(0.98, 0.12, uv.y);

  vec3 deepBlack   = vec3(0.04, 0.04, 0.047);
  vec3 deepEmerald = vec3(0.03, 0.11, 0.04);
  vec3 mossGreen   = vec3(0.22, 0.35, 0.11);
  vec3 acidLime    = vec3(0.55, 0.82, 0.02);
  vec3 neonPeak    = vec3(0.76, 0.98, 0.20);

  vec3 mistColor = mix(deepEmerald, mossGreen, clamp(mist * 1.3, 0.0, 1.0));
  mistColor = mix(mistColor, acidLime, clamp(pow(mist, 1.6) * 1.4, 0.0, 1.0));
  mistColor = mix(mistColor, neonPeak, clamp(pow(mist, 2.9) * 1.2, 0.0, 1.0));

  float waveBand = sin(uv.y * 4.5 - t * 0.4 + q.x * 2.0) * 0.5 + 0.5;
  mistColor += acidLime * waveBand * mist * 0.25;

  vec3 finalColor = mix(deepBlack, mistColor, clamp(verticalMask * baseDensity * 0.88, 0.0, 1.0));

  vec2 starUv = uv * vec2(34.0 * aspect, 34.0);
  vec2 i_star = floor(starUv);
  vec2 f_star = fract(starUv) - 0.5;
  float rnd = hash(i_star);

  if (rnd > 0.85) {
    float size = mix(0.035, 0.10, fract(rnd * 19.3));
    float twinkle = sin(u_time * 2.2 + rnd * 6.28) * 0.5 + 0.5;
    float d = length(f_star);
    float starGlow = smoothstep(size, 0.0, d) * (0.35 + 0.65 * twinkle);
    vec3 starCol = mix(vec3(0.85, 1.0, 0.4), vec3(0.88, 0.86, 1.0), fract(rnd * 41.7));
    finalColor += starCol * starGlow * 0.6;
  }

  float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
  finalColor *= clamp(15.0 * vignette * 0.85 + 0.15, 0.0, 1.0);

  gl_FragColor = vec4(finalColor, 1.0);
}`;

function AuroraCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function syncSize() {
      const w = canvas.clientWidth || window.innerWidth || 1280;
      const h = canvas.clientHeight || window.innerHeight || 720;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncSize);
      ro.observe(canvas);
    }
    syncSize();

    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return;

    function cs(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, cs(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, cs(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const pos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_resolution');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');

    let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        const nx = (event.clientX - rect.left) / rect.width;
        const ny = 1.0 - (event.clientY - rect.top) / rect.height;
        mouse.x = nx * canvas.width;
        mouse.y = ny * canvas.height;
      }
    };
    window.addEventListener('mousemove', handleMouseMove);

    let rafId;
    function render(t) {
      if (typeof ResizeObserver === 'undefined') syncSize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (uTime) gl.uniform1f(uTime, t * 0.001);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafId = requestAnimationFrame(render);
    }
    render(0);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', handleMouseMove);
      if (ro) ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />;
}

/* ── Custom SVG Icons ────────────────────────────────────────────── */
function TicketIcon() {
  return (
    <svg className="w-8 h-8 drop-shadow-[0_0_8px_rgba(202,243,0,0.5)]" fill="none" viewBox="0 0 32 32">
      <defs>
        <linearGradient id="lime-ticket-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d4ff00" offset="0%" />
          <stop stopColor="#caf300" offset="50%" />
          <stop stopColor="#a3e635" offset="100%" />
        </linearGradient>
        <linearGradient id="lime-chip-grad" x1="8" y1="10" x2="14" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ecfccb" offset="0%" />
          <stop stopColor="#84cc16" offset="100%" />
        </linearGradient>
      </defs>
      <path d="M5 8a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v4a2 2 0 0 0 0 4v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-8a2 2 0 0 0 0-4V8z" stroke="url(#lime-ticket-grad)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="rgba(202,243,0,0.06)" />
      <line x1="21" y1="6" x2="21" y2="26" stroke="#caf300" strokeWidth="1.2" strokeDasharray="2 2" opacity="0.7" />
      <rect x="8.5" y="9.5" width="5" height="5" rx="1.2" stroke="url(#lime-chip-grad)" strokeWidth="1.2" fill="rgba(202,243,0,0.25)" />
      <path d="M11 9.5v5M8.5 12h5" stroke="#ecfccb" strokeWidth="0.8" opacity="0.9" />
      <path d="M9 18h7M9 21h5M9 24h3" stroke="#caf300" strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />
      <circle cx="24" cy="14" r="1.2" fill="#caf300" />
      <path d="M23 18.5h2M24 21.5v1" stroke="#caf300" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="w-8 h-8 drop-shadow-[0_0_8px_rgba(184,179,232,0.5)]" fill="none" viewBox="0 0 32 32">
      <defs>
        <linearGradient id="lav-cal-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#dedbf7" offset="0%" />
          <stop stopColor="#b8b3e8" offset="60%" />
          <stop stopColor="#8b5cf6" offset="100%" />
        </linearGradient>
      </defs>
      <rect x="9" y="3" width="2.5" height="4.5" rx="1.2" fill="#dedbf7" />
      <rect x="20.5" y="3" width="2.5" height="4.5" rx="1.2" fill="#dedbf7" />
      <rect x="4.5" y="6" width="23" height="21" rx="4" stroke="url(#lav-cal-grad)" strokeWidth="1.75" fill="rgba(184,179,232,0.07)" />
      <line x1="4.5" y1="12.5" x2="27.5" y2="12.5" stroke="#b8b3e8" strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />
      <circle cx="9" cy="17" r="1.3" fill="#dedbf7" />
      <circle cx="13.5" cy="17" r="1.3" fill="#b8b3e8" opacity="0.75" />
      <circle cx="9" cy="22" r="1.3" fill="#b8b3e8" opacity="0.65" />
      <circle cx="13.5" cy="22" r="1.3" fill="#b8b3e8" opacity="0.55" />
      <circle cx="21" cy="19.5" r="4.5" stroke="#dedbf7" strokeWidth="1.3" strokeDasharray="3 2" fill="rgba(184,179,232,0.18)" />
      <circle cx="21" cy="19.5" r="1.8" fill="#dedbf7" />
      <path d="M21 16.5v1.2M21 21.3v1.2M18 19.5h1.2M22.8 19.5h1.2" stroke="#dedbf7" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="w-8 h-8 drop-shadow-[0_0_8px_rgba(0,238,252,0.5)]" fill="none" viewBox="0 0 32 32">
      <defs>
        <linearGradient id="aqua-shield-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a5f3fc" offset="0%" />
          <stop stopColor="#00eefc" offset="60%" />
          <stop stopColor="#0891b2" offset="100%" />
        </linearGradient>
      </defs>
      <path d="M16 3.5l10.5 3.8v7.4c0 7-4.8 12.6-10.5 14.3-5.7-1.7-10.5-7.3-10.5-14.3V7.3L16 3.5z" stroke="url(#aqua-shield-grad)" strokeWidth="1.75" strokeLinejoin="round" fill="rgba(0,238,252,0.06)" />
      <path d="M16 7l7.5 2.7v5c0 5.2-3.4 9.2-7.5 10.7-4.1-1.5-7.5-5.5-7.5-10.7v-5L16 7z" stroke="#22d3ee" strokeWidth="1.1" strokeDasharray="2.5 1.5" opacity="0.6" />
      <path d="M12 16.2l3 3 6-6.4" stroke="#a5f3fc" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="23.5" r="1" fill="#00eefc" />
    </svg>
  );
}

/* ── Main Component ──────────────────────────────────────────────── */
const CONFIGURED_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS || "").trim()
const ETHERSCAN_HREF = /^0x[0-9a-fA-F]{40}$/.test(CONFIGURED_ADDRESS)
  ? `https://sepolia.etherscan.io/address/${CONFIGURED_ADDRESS}`
  : "https://sepolia.etherscan.io"

export default function RoleLanding({ account, contract, contractOwner, connectWallet, onSwitchAccount, onSelectRole, isConnecting }) {
  const [validatingRole, setValidatingRole] = useState(null);
  const [errors, setErrors] = useState({ attendee: '', organizer: '', verifier: '' });

  const handleRoleSelect = async (role) => {
    setErrors({ attendee: '', organizer: '', verifier: '' });
    setValidatingRole(role);
    try {
      let currentAccount = account;
      let currentContract = contract;
      let currentOwner = contractOwner;

      if (!currentAccount || !currentContract) {
        const connection = await connectWallet();
        if (!connection) {
          setValidatingRole(null);
          return;
        }
        currentAccount = connection.account;
        currentContract = connection.contract;
        currentOwner = connection.owner;
      }

      if (role === 'attendee') {
        onSelectRole('attendee');
      } else if (role === 'organizer') {
        if (!currentOwner && currentContract) {
          currentOwner = await currentContract.owner();
        }
        const isOwner = currentAccount && currentOwner && currentAccount.toLowerCase() === currentOwner.toLowerCase();
        if (isOwner) {
          onSelectRole('organizer');
        } else {
          setErrors(prev => ({ ...prev, organizer: 'This wallet is not authorized as an organizer (Contract Owner required).' }));
        }
      } else if (role === 'verifier') {
        if (!currentOwner && currentContract) {
          currentOwner = await currentContract.owner();
        }
        const isOwner = currentAccount && currentOwner && currentAccount.toLowerCase() === currentOwner.toLowerCase();
        const isVerifier = currentContract ? await currentContract.authorizedVerifiers(currentAccount) : false;
        if (isOwner || isVerifier) {
          onSelectRole('verifier');
        } else {
          setErrors(prev => ({ ...prev, verifier: 'This wallet is not an authorized verifier.' }));
        }
      }
    } catch (err) {
      console.error('Error validating ' + role + ' role:', err);
      setErrors(prev => ({ ...prev, [role]: err.message || 'Failed to validate role.' }));
    } finally {
      setValidatingRole(null);
    }
  };

  const shortAddr = account ? `${account.slice(0, 6)}...${account.slice(-4)}` : null;

  return (
    <div className="relative min-h-screen flex flex-col justify-between selection:bg-cyan-500/30 selection:text-cyan-200 bg-[#040608] text-[#e2e8f0] overflow-x-hidden font-sans">
      
      {/* ── WebGL Shader Background ── */}
      <div className="fixed inset-0 w-full h-full pointer-events-none -z-10">
        <AuroraCanvas />
      </div>

      {/* Noise grain overlay */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-[2] opacity-[0.035]"
        style={{
          background: 'radial-gradient(#ffffff, rgba(255,255,255,0.2) 2px, transparent 40px)',
          backgroundSize: '8px 8px'
        }}
      />

      {/* Radial Fog Behind Main Title */}
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[450px] bg-gradient-to-tr from-emerald-950/20 via-purple-900/15 to-cyan-900/20 blur-[130px] rounded-full pointer-events-none z-0" />

      {/* ── HEADER ── */}
      <header className="relative z-30 pt-6 px-4 sm:px-8 max-w-7xl mx-auto w-full" data-purpose="main-navigation">
        <div className="flex items-center justify-between backdrop-blur-md bg-[#090d14]/75 border border-white/[0.08] px-5 py-3.5 rounded-2xl shadow-2xl shadow-black/60">
          
          {/* Logo Branding */}
          <div className="flex items-center space-x-3.5" data-purpose="brand-identity">
            <div className="relative group cursor-pointer">
              <div className="absolute -inset-1 rounded-xl bg-gradient-to-r from-[#caf300]/40 via-[#b8b3e8]/40 to-[#00eefc]/40 opacity-60 blur-sm group-hover:opacity-100 transition duration-300"></div>
              <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-[#111726] to-[#090d16] border border-white/20 flex items-center justify-center font-black text-white text-lg tracking-wider shadow-[0_0_20px_rgba(184,179,232,0.3)] group-hover:border-[#b8b3e8] transition duration-300">
                <span className="text-transparent bg-clip-text bg-gradient-to-br from-white via-[#b8b3e8] to-[#00eefc]">T</span>
              </div>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-lg tracking-tight text-white font-display">
                  TRUST<span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-[#b8b3e8]">IX</span>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-[#caf300] shadow-[0_0_6px_#caf300]"></span>
                <span className="text-[9px] font-mono tracking-widest uppercase text-slate-400 font-medium">Secure Web3 Ticketing</span>
              </div>
            </div>
          </div>

          {/* Center Protocol Label */}
          <div className="hidden lg:flex items-center font-mono text-[11px] text-slate-400 tracking-wider">
            <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.07] text-slate-300">PROTOCOL V2.4</span>
          </div>

          {/* Wallet & Network Status Container */}
          <div className="flex items-center space-x-3" data-purpose="wallet-status">
            {/* Live Node Status */}
            <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05] font-mono text-[11px] text-slate-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>SEPOLIA</span>
              <span className="text-white/25">/</span>
              <span className="text-slate-400">TESTNET</span>
            </div>

            {/* My Activity Link */}
            {account && (
              <a
                href={`https://sepolia.etherscan.io/address/${account}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.05] hover:border-cyan-500/30 font-mono text-[11px] text-slate-400 hover:text-cyan-300 transition-colors duration-200"
              >
                <span>My Activity</span>
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
              </a>
            )}

            {/* Wallet Status / Connect Button */}
            {shortAddr ? (
              <button
                onClick={onSwitchAccount || connectWallet}
                title="Click to switch account"
                className="flex items-center space-x-2.5 px-3.5 py-1.5 rounded-xl bg-[#111726]/90 hover:bg-[#1a233a] border border-slate-700/60 hover:border-cyan-500/50 shadow-inner transition-all duration-200 cursor-pointer text-left"
              >
                <span className="text-[11px] font-mono tracking-tight text-slate-400 hidden xs:inline">Connected:</span>
                <span className="text-[12px] font-mono font-medium text-cyan-300">{shortAddr}</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-ping"></span>
                <span className="-ml-2 w-2 h-2 rounded-full bg-emerald-400"></span>
              </button>
            ) : (
              <button
                onClick={connectWallet}
                disabled={isConnecting}
                className="flex items-center space-x-2 px-3.5 py-1.5 rounded-xl bg-[#111726]/90 hover:bg-[#1a233a] border border-slate-700/60 hover:border-cyan-500/50 shadow-inner transition-all duration-200 cursor-pointer"
              >
                <span className="text-[12px] font-mono font-medium text-cyan-300">
                  {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="relative z-10 flex-grow max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-14 flex flex-col items-center justify-center">
        
        {/* Hero Title Section */}
        <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-12" data-purpose="hero-header">
          {/* Main Ambient Title */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white font-display leading-[1.1] mb-4">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-purple-300 to-indigo-300 drop-shadow-[0_4px_30px_rgba(236,72,153,0.3)]">
              TRUSTIX
            </span>
            <span className="text-white/40 font-light mx-1"> — </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 via-white to-purple-200">
              Secure Web3 Ticketing
            </span>
          </h1>

          {/* Sub-headline */}
          <p className="text-slate-400 text-sm sm:text-base font-normal max-w-xl mx-auto font-sans tracking-wide leading-relaxed">
            Choose your portal to manage, purchase, or verify secure event passes.
          </p>
        </div>

        {/* Portal Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 w-full max-w-6xl mx-auto" data-purpose="portal-cards-section">
          
          {/* ================= PORTAL 01: ATTENDEE ================= */}
          <div className="group relative rounded-3xl bg-[#090d16]/85 backdrop-blur-md border border-white/[0.08] p-7 sm:p-8 flex flex-col justify-between transition-all duration-300 hover:border-[#caf300]/60 hover:bg-[#0c121e]/90 hover:-translate-y-1.5 shadow-2xl shadow-black/80">
            {/* Top Electric Acid-Lime Accent Glow Bar */}
            <div className="absolute top-0 left-6 right-6 h-[2px] bg-gradient-to-r from-transparent via-[#caf300] to-transparent opacity-90 group-hover:opacity-100 group-hover:shadow-[0_0_15px_#caf300] transition-all"></div>
            <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-[#caf300]/[0.08] to-transparent pointer-events-none rounded-t-3xl"></div>
            
            <div>
              {/* Portal Icon */}
              <div className="relative w-14 h-14 rounded-2xl bg-[#caf300]/10 backdrop-blur-md border border-[#caf300]/40 flex items-center justify-center mb-6 text-[#caf300] group-hover:scale-105 group-hover:border-[#caf300] transition duration-300 shadow-[0_0_20px_rgba(202,243,0,0.25)]">
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#caf300] shadow-[0_0_8px_#caf300] animate-pulse"></span>
                <TicketIcon />
              </div>

              {/* Micro Label & Title */}
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#caf300]/80 font-semibold mb-1">
                PORTAL 01 — ATTENDEE
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight font-display mb-2">Attendee</h2>
              <p className="text-xs text-slate-400 leading-relaxed mb-6 font-normal">
                Browse active events and buy tickets.
              </p>

              {/* Bullet Features */}
              <ul className="space-y-3 font-sans text-xs text-slate-300 mb-8">
                <li className="flex items-center space-x-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#caf300] shadow-[0_0_6px_#caf300]"></span>
                  <span>Browse events</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#caf300] shadow-[0_0_6px_#caf300]"></span>
                  <span>Mint NFT passes</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#caf300] shadow-[0_0_6px_#caf300]"></span>
                  <span>Resell securely</span>
                </li>
              </ul>

              {errors.attendee && (
                <div className="text-red-400 text-xs px-3 py-2 rounded-xl mb-4 bg-red-500/10 border border-red-500/20 font-mono">
                  {errors.attendee}
                </div>
              )}
            </div>

            {/* Footer / Action Area */}
            <div className="pt-4 border-t border-white/[0.04] space-y-4">
              <div className="w-full py-2 px-3 rounded-xl bg-black/40 border border-[#caf300]/20 text-center font-mono text-[11px] text-slate-300">
                Requires: Any Wallet
              </div>
              <button
                onClick={() => handleRoleSelect('attendee')}
                disabled={validatingRole !== null}
                className="w-full py-3.5 px-4 rounded-xl font-sans font-bold text-sm text-[#131315] bg-gradient-to-r from-[#d4ff00] via-[#caf300] to-[#b0d500] hover:from-[#e4ff4a] hover:to-[#caf300] active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 shadow-[0_4px_22px_rgba(202,243,0,0.35)] hover:shadow-[0_6px_28px_rgba(202,243,0,0.55)] cursor-pointer disabled:opacity-60"
                data-purpose="enter-attendee-cta"
              >
                <span>{validatingRole === 'attendee' ? 'Validating...' : 'Enter portal'}</span>
                <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform stroke-[#131315]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              </button>
            </div>
          </div>

          {/* ================= PORTAL 02: ORGANIZER ================= */}
          <div className="group relative rounded-3xl bg-[#090d16]/85 backdrop-blur-md border border-white/[0.08] p-7 sm:p-8 flex flex-col justify-between transition-all duration-300 hover:border-[#b8b3e8]/60 hover:bg-[#0c121e]/90 hover:-translate-y-1.5 shadow-2xl shadow-black/80">
            {/* Top Radiant Periwinkle Accent Glow Bar */}
            <div className="absolute top-0 left-6 right-6 h-[2px] bg-gradient-to-r from-transparent via-[#b8b3e8] to-transparent opacity-90 group-hover:opacity-100 group-hover:shadow-[0_0_15px_#b8b3e8] transition-all"></div>
            <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-[#b8b3e8]/[0.08] to-transparent pointer-events-none rounded-t-3xl"></div>
            
            <div>
              {/* Portal Icon */}
              <div className="relative w-14 h-14 rounded-2xl bg-[#b8b3e8]/10 backdrop-blur-md border border-[#b8b3e8]/40 flex items-center justify-center mb-6 text-[#b8b3e8] group-hover:scale-105 group-hover:border-[#b8b3e8] transition duration-300 shadow-[0_0_20px_rgba(184,179,232,0.25)]">
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#b8b3e8] shadow-[0_0_8px_#b8b3e8] animate-pulse"></span>
                <CalendarIcon />
              </div>

              {/* Micro Label & Title */}
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#b8b3e8]/80 font-semibold mb-1">
                PORTAL 02 — ORGANIZER
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight font-display mb-2">Organizer</h2>
              <p className="text-xs text-slate-400 leading-relaxed mb-6 font-normal">
                Create events and manage gate verifiers.
              </p>

              {/* Bullet Features */}
              <ul className="space-y-3 font-sans text-xs text-slate-300 mb-8">
                <li className="flex items-center space-x-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#b8b3e8] shadow-[0_0_6px_#b8b3e8]"></span>
                  <span>Schedule events</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#b8b3e8] shadow-[0_0_6px_#b8b3e8]"></span>
                  <span>Manage verifiers</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#b8b3e8] shadow-[0_0_6px_#b8b3e8]"></span>
                  <span>Track sales data</span>
                </li>
              </ul>

              {errors.organizer && (
                <div className="text-red-400 text-xs px-3 py-2 rounded-xl mb-4 bg-red-500/10 border border-red-500/20 font-mono">
                  {errors.organizer}
                </div>
              )}
            </div>

            {/* Footer / Action Area */}
            <div className="pt-4 border-t border-white/[0.04] space-y-4">
              <div className="w-full py-2 px-3 rounded-xl bg-black/40 border border-[#b8b3e8]/20 text-center font-mono text-[11px] text-slate-300">
                Requires: Contract Owner
              </div>
              <button
                onClick={() => handleRoleSelect('organizer')}
                disabled={validatingRole !== null}
                className="w-full py-3.5 px-4 rounded-xl font-sans font-semibold text-sm text-[#090d16] bg-gradient-to-r from-[#d8d4ff] via-[#b8b3e8] to-[#9b94df] hover:from-[#eae7ff] hover:to-[#b8b3e8] active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 shadow-[0_4px_22px_rgba(184,179,232,0.35)] hover:shadow-[0_6px_28px_rgba(184,179,232,0.55)] cursor-pointer disabled:opacity-60"
                data-purpose="enter-organizer-cta"
              >
                <span>{validatingRole === 'organizer' ? 'Validating...' : 'Enter portal'}</span>
                <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform stroke-[#090d16]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              </button>
            </div>
          </div>

          {/* ================= PORTAL 03: VERIFIER ================= */}
          <div className="group relative rounded-3xl bg-[#090d16]/85 backdrop-blur-md border border-white/[0.08] p-7 sm:p-8 flex flex-col justify-between transition-all duration-300 hover:border-[#00eefc]/60 hover:bg-[#0c121e]/90 hover:-translate-y-1.5 shadow-2xl shadow-black/80">
            {/* Top Arctic Aqua Accent Glow Bar */}
            <div className="absolute top-0 left-6 right-6 h-[2px] bg-gradient-to-r from-transparent via-[#00eefc] to-transparent opacity-90 group-hover:opacity-100 group-hover:shadow-[0_0_15px_#00eefc] transition-all"></div>
            <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-[#00eefc]/[0.08] to-transparent pointer-events-none rounded-t-3xl"></div>
            
            <div>
              {/* Portal Icon */}
              <div className="relative w-14 h-14 rounded-2xl bg-[#00eefc]/10 backdrop-blur-md border border-[#00eefc]/40 flex items-center justify-center mb-6 text-[#00eefc] group-hover:scale-105 group-hover:border-[#00eefc] transition duration-300 shadow-[0_0_20px_rgba(0,238,252,0.25)]">
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#00eefc] shadow-[0_0_8px_#00eefc] animate-pulse"></span>
                <ShieldIcon />
              </div>

              {/* Micro Label & Title */}
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#00eefc]/80 font-semibold mb-1">
                PORTAL 03 — VERIFIER
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight font-display mb-2">Verifier</h2>
              <p className="text-xs text-slate-400 leading-relaxed mb-6 font-normal">
                Scan QR tickets and check in attendees.
              </p>

              {/* Bullet Features */}
              <ul className="space-y-3 font-sans text-xs text-slate-300 mb-8">
                <li className="flex items-center space-x-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00eefc] shadow-[0_0_6px_#00eefc]"></span>
                  <span>Scan QR tickets</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00eefc] shadow-[0_0_6px_#00eefc]"></span>
                  <span>Rapid gate check-in</span>
                </li>
                <li className="flex items-center space-x-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00eefc] shadow-[0_0_6px_#00eefc]"></span>
                  <span>Authenticate passes</span>
                </li>
              </ul>

              {errors.verifier && (
                <div className="text-red-400 text-xs px-3 py-2 rounded-xl mb-4 bg-red-500/10 border border-red-500/20 font-mono">
                  {errors.verifier}
                </div>
              )}
            </div>

            {/* Footer / Action Area */}
            <div className="pt-4 border-t border-white/[0.04] space-y-4">
              <div className="w-full py-2 px-3 rounded-xl bg-black/40 border border-[#00eefc]/20 text-center font-mono text-[11px] text-slate-300">
                Requires: Verifier Role
              </div>
              <button
                onClick={() => handleRoleSelect('verifier')}
                disabled={validatingRole !== null}
                className="w-full py-3.5 px-4 rounded-xl font-sans font-semibold text-sm text-[#00363a] bg-gradient-to-r from-[#7df4ff] via-[#00eefc] to-[#00c5d2] hover:from-[#a5f8ff] hover:to-[#00eefc] active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 shadow-[0_4px_22px_rgba(0,238,252,0.35)] hover:shadow-[0_6px_28px_rgba(0,238,252,0.55)] cursor-pointer disabled:opacity-60"
                data-purpose="enter-verifier-cta"
              >
                <span>{validatingRole === 'verifier' ? 'Validating...' : 'Enter portal'}</span>
                <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform stroke-[#00363a]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              </button>
            </div>
          </div>

        </div>
      </main>

      {/* ── FOOTER ── */}
      <footer className="relative z-30 py-6 border-t border-white/[0.06] bg-black/40 backdrop-blur-md" data-purpose="editorial-footer">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 flex flex-col md:flex-row items-center justify-between gap-4 font-mono text-[11px] text-slate-400">
          {/* Left Info: On-chain ledger status */}
          <div className="flex items-center space-x-3">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500/70 animate-pulse"></span>
            <span className="tracking-wider uppercase text-slate-400">All transactions verified on-chain</span>
            <span className="text-white/20 hidden sm:inline">•</span>
            <span className="hidden sm:inline text-slate-400">GAS: 18 GWEI</span>
          </div>
          {/* Right Actions / Reference Links */}
          <div className="flex items-center space-x-6 tracking-wider">
            <a
              className="text-slate-400 hover:text-white transition-colors duration-200 flex items-center gap-1"
              href={ETHERSCAN_HREF}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>View on Etherscan</span>
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
            </a>
            <a
              className="text-slate-400 hover:text-white transition-colors duration-200 flex items-center gap-1"
              href="https://github.com/prakhargit-04/event-ticketing-dapp#readme"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>Docs</span>
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
            </a>
            <span className="text-white/20">|</span>
            <span className="text-slate-400 font-sans text-xs">© 2025 TRUSTIX PROTOCOL</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
