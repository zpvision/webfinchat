const scenes = ['mountains', 'ocean', 'forest', 'dunes', 'aurora'];

function Landscape({ scene }) {
  const sky = `call-sky-${scene}`;
  const moon = `call-moon-${scene}`;
  const palettes = {
    mountains: ['#3b336c', '#a584b5'], ocean: ['#293b68', '#b38fae'],
    forest: ['#253b54', '#779eaa'], dunes: ['#59406c', '#d9a19e'], aurora: ['#1e344e', '#547c8c'],
  };
  const [top, bottom] = palettes[scene];
  return <svg className="call-landscape" viewBox="0 0 480 300" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={sky} x1="240" y1="0" x2="240" y2="300" gradientUnits="userSpaceOnUse"><stop stopColor={top} /><stop offset="1" stopColor={bottom} /></linearGradient>
      <radialGradient id={moon}><stop stopColor="#fff4dc" /><stop offset="1" stopColor="#f0d7eb" /></radialGradient>
      <linearGradient id={`call-aurora-glow-${scene}`} x1="200" y1="10" x2="230" y2="190" gradientUnits="userSpaceOnUse"><stop stopColor="#94d8c4" stopOpacity="0" /><stop offset=".5" stopColor="#94d8c4" stopOpacity=".5" /><stop offset="1" stopColor="#ab9fd8" stopOpacity="0" /></linearGradient>
    </defs>
    <path fill={`url(#${sky})`} d="M0 0h480v300H0z" />
    <g fill="#f8edff" opacity=".7"><circle cx="70" cy="44" r="1.3" /><circle cx="170" cy="68" r="1" /><circle cx="254" cy="32" r="1.2" /><circle cx="409" cy="49" r="1" /><circle cx="291" cy="111" r="1" /><circle cx="113" cy="110" r="1" /><path d="m210 29 1.2 3.8L215 34l-3.8 1.2L210 39l-1.2-3.8L205 34l3.8-1.2Z" /></g>
    <circle cx={scene === 'dunes' ? 136 : 348} cy="81" r="55" fill="#f4d6f1" opacity=".05" /><circle cx={scene === 'dunes' ? 136 : 348} cy="81" r="41" fill="#f4d6f1" opacity=".08" /><circle cx={scene === 'dunes' ? 136 : 348} cy="81" r="27" fill={`url(#${moon})`} />
    {scene === 'mountains' && <>
      <path d="m0 208 69-59 38 29 69-78 72 93 49-44 50 37 54-56 79 66v104H0Z" fill="#6d608e" />
      <path d="m145 135 31-35 37 48-29-16-12 8-8-10Z" fill="#d0bad8" opacity=".58" />
      <path d="m0 237 83-58 75 61 63-39 86 38 80-58 93 48v71H0Z" fill="#403959" /><path d="m0 268 100-32 92 35 112-21 89 17 87-27v60H0Z" fill="#27263f" />
      <path d="M203 300c-24-23 77-23 56-44-9-9-34-12-38-21" stroke="#b8a7d1" strokeWidth="2" opacity=".35" />
      <g fill="#25253e"><path d="m39 199-13 28h8l-14 26h14v23h10v-23h14l-14-26h8Zm401 1-12 25h7l-14 27h14v26h10v-26h14l-14-27h7Z" /></g>
    </>}
    {scene === 'ocean' && <>
      <path d="M0 170h480v130H0Z" fill="#4e5c83" /><path d="M0 195q80-23 160 0t160 0 160 0v105H0Z" fill="#414d74" />
      <path d="M0 223q60-20 120-1t120 0 120 0 120-3v81H0Z" fill="#333c60" />
      <g stroke="#d6c1e2" opacity=".4" strokeLinecap="round"><path d="M323 177h50m-66 9h66m-43 11h32m-64 13h67m-30 13h42M30 201h54m77 25h52m-96 21h30" /></g>
      <path d="m0 300 33-67 31 9 24-32 39 13 36 77Zm480 0-38-83-31 15-36-46-29 16-52 98Z" fill="#272940" />
      <path d="m99 111 7-4 7 4m11-8 6-3 6 3" stroke="#e6d7e6" strokeWidth="1.5" opacity=".6" />
    </>}
    {scene === 'forest' && <>
      <path d="M0 188q70-69 147-15t162-13 171 17v123H0Z" fill="#587e89" /><path d="M0 222q100-42 213-6t267-22v106H0Z" fill="#3d616d" />
      <path d="M163 300q130-53 92-74c-16-9-50-12-27-23-61 23 46 39-78 59l-86 38Z" fill="#9aafb8" opacity=".5" />
      {[28, 78, 126, 318, 371, 431, 466].map((x, i) => <g key={x} transform={`translate(${x} ${140 + (i % 3) * 18})`} fill={i % 2 ? '#2a4958' : '#253e50'}><path d="m0 0-21 43h11l-22 33h14l-24 38h36v30H6v-30h36L18 76h14L10 43h11Z" /></g>)}
      <path d="M0 276q95-15 166 12t165-6 149-6v24H0Z" fill="#263847" />
    </>}
    {scene === 'dunes' && <>
      <path d="M0 209q126-123 272-12t208-26v129H0Z" fill="#ab7d98" /><path d="M0 232q123 55 245-30t235 14v84H0Z" fill="#815f83" />
      <path d="M0 251q178-66 300 7t180-6v48H0Z" fill="#55445f" /><path d="M0 205q125-96 228-32m-43 68q131-74 215-51" stroke="#e5b9ba" opacity=".35" />
      <path d="m378 192 3-4 3 4m-29-3 3-4 3 4" stroke="#534062" strokeWidth="1.4" /><path d="M0 289q101-18 197 11H0Z" fill="#302a43" />
    </>}
    {scene === 'aurora' && <>
      <path d="M-30 60Q90 173 200 64T510 75v76Q366 30 226 153T-30 133Z" fill="url(#call-aurora-glow-aurora)" />
      <path d="M-20 97Q120 183 260 70T500 111" stroke="#a6dfc7" strokeWidth="2" opacity=".22" />
      <path d="m0 223 72-56 54 42 72-69 79 75 60-53 68 43 75-38v133H0Z" fill="#466278" />
      <path d="m164 174 34-34 38 36-28-11-12 6-9-9Z" fill="#b7c5d7" opacity=".6" /><path d="M0 239q93-35 192 4t288-13v70H0Z" fill="#304555" />
      <path d="M0 274q109-30 231 7t249-14v33H0Z" fill="#252f43" />
      <g stroke="#c5dbdd" opacity=".25"><path d="M76 258h72m175-8h89m-207 19h43" /></g>
    </>}
  </svg>;
}

export function CallScenery() {
  return <div className="call-scenery" aria-hidden="true">
    {scenes.map((scene, index) => <div className={`call-scene call-scene-${index}`} key={scene}><Landscape scene={scene} /></div>)}
  </div>;
}
