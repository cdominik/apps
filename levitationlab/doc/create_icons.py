#!/usr/bin/env python3
"""
Generate all SVG icon files for the Levitation Lab LaTeX documentation.

Run from the directory containing levitation_lab_technical.tex:
    python3 create_icons.py

Output: icons/*.svg  (36 files, one per \\btnicon{} reference in the .tex)
"""

import os

os.makedirs('icons', exist_ok=True)

ICONS = {}

# =============================================================================
# RIGHT WING: ACTION CONTROLS
# =============================================================================

ICONS['btnStart'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Injector manifold -->
  <rect x="3" y="3" width="18" height="5" rx="1"
        fill="none" stroke="currentColor" stroke-width="1.4"/>
  <!-- Nozzle jets -->
  <line x1="8"  y1="8" x2="7"  y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <line x1="16" y1="8" x2="17" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <!-- Falling particles -->
  <circle cx="7"  cy="14" r="1.4" fill="currentColor"/>
  <circle cx="12" cy="15" r="1.4" fill="currentColor"/>
  <circle cx="17" cy="13" r="1.4" fill="currentColor"/>
  <circle cx="9"  cy="19" r="1.4" fill="currentColor"/>
  <circle cx="15" cy="20" r="1.4" fill="currentColor"/>
</svg>"""

ICONS['btnSound'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <path d="M4 9 L4 15 L8 15 L13 19 L13 5 L8 9 Z" fill="currentColor"/>
  <path d="M16 8 Q19 12 16 16"
        fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M18.5 6 Q22 12 18.5 18"
        fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>"""

ICONS['btnOmegaCtl'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <text x="12" y="17" text-anchor="middle"
        font-family="serif" font-size="18" font-weight="bold"
        fill="currentColor">&#937;</text>
</svg>"""

# Expanded from the original <use href="#sp-cell"> version for portability
ICONS['btnTrails'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24" width="20" height="20">
  <!-- 0 deg -->
  <path d="M 0 -9 Q 1.6 -5 0.8 -1 Q 0.2 1.5 -0.6 4 Q -1.4 6.5 -2.4 8.5"
        fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  <circle cx="0" cy="-9" r="2.2" fill="currentColor"/>
  <!-- 120 deg -->
  <g transform="rotate(120)">
    <path d="M 0 -9 Q 1.6 -5 0.8 -1 Q 0.2 1.5 -0.6 4 Q -1.4 6.5 -2.4 8.5"
          fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="0" cy="-9" r="2.2" fill="currentColor"/>
  </g>
  <!-- 240 deg -->
  <g transform="rotate(240)">
    <path d="M 0 -9 Q 1.6 -5 0.8 -1 Q 0.2 1.5 -0.6 4 Q -1.4 6.5 -2.4 8.5"
          fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="0" cy="-9" r="2.2" fill="currentColor"/>
  </g>
</svg>"""

# Expanded from the original <use> version
ICONS['btnLaser'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24" width="20" height="20">
  <g fill="currentColor">
    <!-- Cardinal rays (long) -->
    <polygon points="0,-11 0.7,-2.2 -0.7,-2.2"/>
    <g transform="rotate(90)"> <polygon points="0,-11 0.7,-2.2 -0.7,-2.2"/> </g>
    <g transform="rotate(180)"><polygon points="0,-11 0.7,-2.2 -0.7,-2.2"/> </g>
    <g transform="rotate(270)"><polygon points="0,-11 0.7,-2.2 -0.7,-2.2"/> </g>
    <!-- Diagonal rays (medium) -->
    <g transform="rotate(45)"> <polygon points="0,-9.5 0.6,-2.2 -0.6,-2.2"/> </g>
    <g transform="rotate(135)"><polygon points="0,-9.5 0.6,-2.2 -0.6,-2.2"/> </g>
    <g transform="rotate(225)"><polygon points="0,-9.5 0.6,-2.2 -0.6,-2.2"/> </g>
    <g transform="rotate(315)"><polygon points="0,-9.5 0.6,-2.2 -0.6,-2.2"/> </g>
    <!-- Short rays -->
    <g transform="rotate(22.5)"> <polygon points="0,-5.5 0.5,-2.2 -0.5,-2.2"/> </g>
    <g transform="rotate(67.5)"> <polygon points="0,-5.5 0.5,-2.2 -0.5,-2.2"/> </g>
    <g transform="rotate(112.5)"><polygon points="0,-5.5 0.5,-2.2 -0.5,-2.2"/> </g>
    <g transform="rotate(157.5)"><polygon points="0,-5.5 0.5,-2.2 -0.5,-2.2"/> </g>
    <g transform="rotate(202.5)"><polygon points="0,-5.5 0.5,-2.2 -0.5,-2.2"/> </g>
    <g transform="rotate(247.5)"><polygon points="0,-5.5 0.5,-2.2 -0.5,-2.2"/> </g>
    <g transform="rotate(292.5)"><polygon points="0,-5.5 0.5,-2.2 -0.5,-2.2"/> </g>
    <g transform="rotate(337.5)"><polygon points="0,-5.5 0.5,-2.2 -0.5,-2.2"/> </g>
    <!-- Centre -->
    <circle cx="0" cy="0" r="2.2"/>
  </g>
</svg>"""

ICONS['btnMicro'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <g fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 4 L13 4 L13 11 L9 11 Z"/>
    <path d="M11 11 L11 14"/>
    <circle cx="11" cy="16.5" r="2.2"/>
    <path d="M6 21 L18 21"/>
    <path d="M8 21 L8 19 L14 19 L14 21"/>
    <path d="M13 4 L16 6"/>
  </g>
</svg>"""

ICONS['btnChart'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <g fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 20 L4 4"/>
    <path d="M4 20 L20 20"/>
    <path d="M6 16 L10 11 L13 13 L18 6"/>
    <circle cx="6"  cy="16" r="0.8" fill="currentColor"/>
    <circle cx="10" cy="11" r="0.8" fill="currentColor"/>
    <circle cx="13" cy="13" r="0.8" fill="currentColor"/>
    <circle cx="18" cy="6"  r="0.8" fill="currentColor"/>
  </g>
</svg>"""

ICONS['btnTheme'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <g fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 17 L15 17"/>
    <path d="M9.5 19 L14.5 19"/>
    <path d="M10.5 21 L13.5 21"/>
    <path d="M8.5 15.5 C 7 14 6.2 12.2 6.2 10.3
             C 6.2 7 8.8 4.3 12 4.3
             C 15.2 4.3 17.8 7 17.8 10.3
             C 17.8 12.2 17 14 15.5 15.5 Z"/>
    <path d="M10 15.5 C 10 13 11 11 12 9 C 13 11 14 13 14 15.5"/>
  </g>
</svg>"""

ICONS['btnGameMode'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Five-pointed star -->
  <path d="M12 3 L14.1 9.3 L20.8 9.3 L15.4 13 L17.5 19.3
           L12 15.6 L6.5 19.3 L8.6 13 L3.2 9.3 L9.9 9.3 Z"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>"""

ICONS['btnChallenge'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Trophy cup -->
  <path d="M8 3 L16 3 L16 12 C16 15.3 14.2 17 12 17 C9.8 17 8 15.3 8 12 Z"
        fill="none" stroke="currentColor" stroke-width="1.5"/>
  <!-- Handles -->
  <path d="M5 4 C4 4 3 5 3 8 C3 11 5.5 12.5 8 12.5"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M19 4 C20 4 21 5 21 8 C21 11 18.5 12.5 16 12.5"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <!-- Stem and base -->
  <line x1="12" y1="17" x2="12"  y2="20"
        stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="8.5" y1="20" x2="15.5" y2="20"
        stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>"""

ICONS['btnManual'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Info circle -->
  <circle cx="12" cy="12" r="9"
          fill="none" stroke="currentColor" stroke-width="1.5"/>
  <line x1="12" y1="11" x2="12" y2="17"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <circle cx="12" cy="7.5" r="1.2" fill="currentColor"/>
</svg>"""

ICONS['btnReset'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <path d="M 20 12 A 8 8 0 1 1 14.5 4.8"
        fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <polyline points="14,2 14.5,5 18,4"
            fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"/>
</svg>"""

# =============================================================================
# LEFT WING: SELECTORS
# =============================================================================

ICONS['winNP'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Five dots suggesting a particle count -->
  <circle cx="6"  cy="12" r="2.2" fill="currentColor"/>
  <circle cx="12" cy="7"  r="2.2" fill="currentColor"/>
  <circle cx="18" cy="12" r="2.2" fill="currentColor"/>
  <circle cx="12" cy="17" r="2.2" fill="currentColor"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>"""

ICONS['winVT'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Single particle settling downward -->
  <circle cx="12" cy="5.5" r="3"
          fill="none" stroke="currentColor" stroke-width="1.5"/>
  <line x1="12" y1="8.5" x2="12" y2="17"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <polyline points="9,14 12,18.5 15,14"
            fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"/>
</svg>"""

ICONS['winSpread'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Bell curve suggesting spread -->
  <path d="M2,19 Q4,19 6,16 Q9,9 12,8 Q15,9 18,16 Q20,19 22,19"
        fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="2"  y1="19" x2="22" y2="19"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <!-- Centre dashed line -->
  <line x1="12" y1="19" x2="12" y2="9"
        stroke="currentColor" stroke-width="1" stroke-dasharray="2,2"/>
</svg>"""

ICONS['winDT'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Clock face -->
  <circle cx="12" cy="12" r="9"
          fill="none" stroke="currentColor" stroke-width="1.5"/>
  <!-- Hour hand (pointing to ~12) -->
  <line x1="12" y1="12" x2="12" y2="6"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <!-- Minute hand (pointing to ~3) -->
  <line x1="12" y1="12" x2="17" y2="12"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="12" cy="12" r="1" fill="currentColor"/>
</svg>"""

# =============================================================================
# EXPERT PANEL: HUD
# =============================================================================

ICONS['btnVtProj'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Horizontal axis line -->
  <line x1="4" y1="12" x2="20" y2="12"
        stroke="currentColor" stroke-width="1.5"/>
  <!-- Endpoint dots -->
  <circle cx="5"  cy="12" r="2"   fill="currentColor"/>
  <circle cx="19" cy="12" r="2"   fill="currentColor"/>
  <!-- Centre orbit ring -->
  <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
</svg>"""

ICONS['btnFlashOrbit'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Orbit centre -->
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
  <!-- Dashed orbit ring -->
  <circle cx="12" cy="12" r="7"
          fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2,1"/>
  <!-- Small aggregate cluster near the ring -->
  <circle cx="18.0" cy="6.5" r="1.2" fill="currentColor"/>
  <circle cx="16.2" cy="7.8" r="1.0" fill="currentColor"/>
  <circle cx="19.5" cy="8.2" r="0.9" fill="currentColor"/>
</svg>"""

ICONS['btnAggEncounters'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Two aggregate circles -->
  <circle cx="5"  cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <circle cx="19" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <!-- Dashed connector -->
  <line x1="8.5" y1="12" x2="14.5" y2="12"
        stroke="currentColor" stroke-width="1.2" stroke-dasharray="2,1.5"/>
  <!-- Midpoint crosshair -->
  <circle cx="12" cy="12" r="1.2" fill="currentColor"/>
  <line x1="12" y1="9.5"  x2="12" y2="10.5" stroke="currentColor" stroke-width="1.2"/>
  <line x1="12" y1="13.5" x2="12" y2="14.5" stroke="currentColor" stroke-width="1.2"/>
  <line x1="10" y1="12"   x2="11" y2="12"   stroke="currentColor" stroke-width="1.2"/>
  <line x1="13" y1="12"   x2="14" y2="12"   stroke="currentColor" stroke-width="1.2"/>
</svg>"""

ICONS['btnVtDist'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Baseline -->
  <line x1="2" y1="19" x2="22" y2="19"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <!-- KDE bell curve -->
  <path d="M2,18 Q5,18 7,15 Q9,9 12,8 Q15,7 17,12 Q19,16 20,18 Q21,18 22,18"
        fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Two aggregate histogram bars -->
  <rect x="8.5" y="13" width="2.5" height="6" fill="currentColor" opacity="0.45"/>
  <rect x="13"  y="11" width="2.5" height="8" fill="currentColor" opacity="0.65"/>
</svg>"""

ICONS['btnAggHist'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Small aggregate cluster top-left -->
  <circle cx="5.5" cy="5.5" r="1.4" fill="currentColor"/>
  <circle cx="7.5" cy="4.5" r="1.1" fill="currentColor"/>
  <circle cx="4.5" cy="7.2" r="1.0" fill="currentColor"/>
  <circle cx="7.2" cy="6.8" r="1.0" fill="currentColor"/>
  <!-- Histogram bars -->
  <rect x="3"  y="16" width="3" height="5"  fill="currentColor" opacity="0.50"/>
  <rect x="7"  y="13" width="3" height="8"  fill="currentColor" opacity="0.65"/>
  <rect x="11" y="9"  width="3" height="12" fill="currentColor" opacity="0.80"/>
  <rect x="15" y="5"  width="3" height="16" fill="currentColor"/>
  <rect x="19" y="11" width="3" height="10" fill="currentColor" opacity="0.70"/>
  <!-- Baseline -->
  <line x1="2" y1="21" x2="22" y2="21"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>"""

ICONS['btnSysSolidMap'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Coloured data dots behind the glass -->
  <circle cx="7"  cy="8"  r="2.5" fill="#ff4040" opacity="0.6"/>
  <circle cx="16" cy="10" r="3"   fill="#40ff70" opacity="0.5"/>
  <circle cx="11" cy="16" r="2"   fill="#ffee33" opacity="0.65"/>
  <!-- Milky glass overlay -->
  <circle cx="12" cy="12" r="10"
          fill="#ffffff" opacity="0.45"
          stroke="currentColor" stroke-width="1" stroke-opacity="0.6"/>
  <!-- Specular glare arc -->
  <path d="M 5.5 8.5 A 7.5 7.5 0 0 1 18.5 8.5"
        fill="none" stroke="#ffffff" stroke-width="1.2"
        stroke-linecap="round" opacity="0.4"/>
</svg>"""

ICONS['btnHudMaster'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- AR corner brackets -->
  <path d="M4 9 L4 4 L9 4"
        fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M15 4 L20 4 L20 9"
        fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M4 15 L4 20 L9 20"
        fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M15 20 L20 20 L20 15"
        fill="none" stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Central reticle -->
  <circle cx="12" cy="12" r="2.5"
          fill="none" stroke="currentColor" stroke-width="1.2"/>
  <circle cx="12" cy="12" r="0.8" fill="currentColor"/>
  <!-- Tick marks -->
  <line x1="12" y1="7"  x2="12" y2="9"  stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/>
  <line x1="12" y1="15" x2="12" y2="17" stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/>
  <line x1="7"  y1="12" x2="9"  y2="12" stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/>
  <line x1="15" y1="12" x2="17" y2="12" stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/>
</svg>"""

# =============================================================================
# EXPERT PANEL: PROCESSES
# =============================================================================

ICONS['btnProcInvinc'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Shield outline -->
  <path d="M12 3 L20 6.5 L20 13 C20 17.5 16.5 21 12 22.5
           C7.5 21 4 17.5 4 13 L4 6.5 Z"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <!-- Checkmark -->
  <path d="M9 12 L11 14 L15.5 9.5"
        fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>"""

ICONS['btnProcPeb'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Broom handle -->
  <line x1="19" y1="5" x2="10" y2="14"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <!-- Broom head -->
  <path d="M4.5 20 L10 14 L15 17 Z"
        fill="currentColor" stroke="currentColor"
        stroke-width="0.5" stroke-linejoin="round"/>
  <!-- Binding band -->
  <line x1="14" y1="3" x2="18" y2="7"
        stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
</svg>"""

ICONS['btnProcDouble'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Shadow copy (right): top, right side, bottom only — no left edge -->
  <path d="M 11 4 L 16 4 L 16 20 L 11 20"
        fill="none" stroke="#8a6040" stroke-width="1.5"/>
  <circle cx="12.8" cy="6.5"  r="0.7" fill="#8a6040"/>
  <circle cx="14.2" cy="9.5"  r="0.7" fill="#8a6040"/>
  <circle cx="13.5" cy="12.5" r="0.7" fill="#8a6040"/>
  <circle cx="12.8" cy="15.5" r="0.7" fill="#8a6040"/>
  <circle cx="14.0" cy="18.0" r="0.7" fill="#8a6040"/>
  <!-- Original slice (left): full rectangle -->
  <rect x="6" y="4" width="5" height="16"
        fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="7.8" cy="6.5"  r="0.7" fill="currentColor"/>
  <circle cx="9.2" cy="9.5"  r="0.7" fill="currentColor"/>
  <circle cx="7.6" cy="12.5" r="0.7" fill="currentColor"/>
  <circle cx="9.0" cy="15.5" r="0.7" fill="currentColor"/>
  <circle cx="8.0" cy="18.0" r="0.7" fill="currentColor"/>
</svg>"""

ICONS['btnProcPureV'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 75 65 45" width="20" height="20">
  <!-- Balance / Stokes scale -->
  <line x1="20" y1="125" x2="40" y2="125" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <line x1="30" y1="125" x2="30" y2="95"  stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <polygon points="30,94 25,104 35,104" fill="currentColor"/>
  <line x1="5"  y1="90" x2="55" y2="99"  stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <line x1="2"  y1="90" x2="16" y2="90"  stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="44" y1="99" x2="60" y2="99"  stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  <!-- Single monomer (left pan) -->
  <circle cx="9" cy="85" r="4" fill="currentColor"/>
  <!-- Aggregate cluster (right pan) -->
  <circle cx="52" cy="95" r="2.5" fill="currentColor"/>
  <circle cx="56" cy="92" r="2.5" fill="currentColor"/>
  <circle cx="53" cy="88" r="2.5" fill="currentColor"/>
  <circle cx="57" cy="85" r="2.5" fill="currentColor"/>
  <circle cx="54" cy="81" r="2.5" fill="currentColor"/>
  <circle cx="49" cy="85" r="2.5" fill="currentColor"/>
  <circle cx="61" cy="82" r="2.5" fill="currentColor"/>
  <circle cx="48" cy="92" r="2.5" fill="currentColor"/>
</svg>"""

ICONS['btnProcAgg'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Particle cluster -->
  <circle cx="12" cy="12" r="3"   fill="currentColor"/>
  <circle cx="8"  cy="9"  r="2.5" fill="currentColor"/>
  <circle cx="16" cy="10" r="2.5" fill="currentColor"/>
  <circle cx="10" cy="16" r="2.5" fill="currentColor"/>
  <circle cx="15" cy="16" r="2.5" fill="currentColor"/>
  <circle cx="5"  cy="12" r="2"   fill="currentColor"/>
</svg>"""

ICONS['btnProcGrowth'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Small aggregate (left) -->
  <circle cx="7" cy="14" r="2.5" fill="currentColor"/>
  <circle cx="5" cy="11" r="1.8" fill="currentColor"/>
  <circle cx="9" cy="11" r="1.8" fill="currentColor"/>
  <!-- Arrow -->
  <line x1="12" y1="12" x2="16" y2="12"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  <polyline points="14,10 16,12 14,14"
            fill="none" stroke="currentColor" stroke-width="1.4"
            stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Larger aggregate (right) -->
  <circle cx="19" cy="13" r="2.2" fill="currentColor"/>
  <circle cx="17" cy="10" r="1.8" fill="currentColor"/>
  <circle cx="21" cy="10" r="1.8" fill="currentColor"/>
  <circle cx="18" cy="16" r="1.6" fill="currentColor"/>
  <circle cx="21" cy="15" r="1.6" fill="currentColor"/>
</svg>"""

# =============================================================================
# EXPERT PANEL: SYSTEM
# =============================================================================

ICONS['btnDistMenu'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Three distribution bars -->
  <rect x="4"  y="12" width="4" height="8"  fill="currentColor"/>
  <rect x="10" y="6"  width="4" height="14" fill="currentColor"/>
  <rect x="16" y="9"  width="4" height="11" fill="currentColor"/>
</svg>"""

ICONS['btnSysAutoOmega'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Circular arrow (auto-tracking) -->
  <path d="M 20 12 A 8 8 0 1 1 14.5 4.8"
        fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <!-- Arrowhead -->
  <polyline points="13,2 14.5,5 18,4"
            fill="none" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Target dot = levitation zone centre -->
  <circle cx="12" cy="12" r="2.2" fill="currentColor"/>
</svg>"""

ICONS['btnCollect'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Drum circle -->
  <circle cx="12" cy="12" r="9"
          fill="none" stroke="currentColor" stroke-width="1.6"/>
  <!-- Tray blade -->
  <line x1="19.8" y1="16.5" x2="12" y2="16.5"
        stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
  <!-- Hinge on rim -->
  <circle cx="19.8" cy="16.5" r="1.4" fill="currentColor"/>
</svg>"""

ICONS['btnSpeedReset'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Speedometer arc -->
  <path d="M12 5 A7 7 0 1 1 5.5 8.5"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <!-- Needle -->
  <line x1="12" y1="12" x2="15" y2="8"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
  <!-- Reset arrow tip -->
  <path d="M4 5 L5.5 8.5 L8 6"
        fill="none" stroke="currentColor" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>"""

ICONS['btnSysStrobe'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Bright cardinal flashes -->
  <line x1="12" y1="3"  x2="12" y2="7"  stroke="currentColor" stroke-width="2"   stroke-linecap="round"/>
  <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" stroke-width="2"   stroke-linecap="round"/>
  <line x1="3"  y1="12" x2="7"  y2="12" stroke="currentColor" stroke-width="2"   stroke-linecap="round"/>
  <line x1="17" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2"   stroke-linecap="round"/>
  <!-- Faint diagonal intervals -->
  <line x1="5.6"  y1="5.6"  x2="7.8"  y2="7.8"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.35"/>
  <line x1="16.2" y1="16.2" x2="18.4" y2="18.4"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.35"/>
  <line x1="18.4" y1="5.6"  x2="16.2" y2="7.8"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.35"/>
  <line x1="7.8"  y1="16.2" x2="5.6"  y2="18.4"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.35"/>
  <!-- Centre dot -->
  <circle cx="12" cy="12" r="2.2" fill="currentColor"/>
</svg>"""

ICONS['btnProcSlowMo'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Snail shell (spiral circle) -->
  <circle cx="15" cy="11" r="5.5"
          fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="15" cy="11" r="2.5"
          fill="none" stroke="currentColor" stroke-width="1"/>
  <!-- Body -->
  <path d="M9.5 11 C7.5 11 5.5 12 4.5 14 C3.5 16 4.5 19 7 19 L15 19"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <!-- Antennae -->
  <line x1="17"   y1="5.5" x2="18.5" y2="3"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <line x1="19.5" y1="7"   x2="21.5" y2="5.5"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>"""

ICONS['btnProcFast'] = """\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
  <!-- Magnifier with plus (zoom in) -->
  <circle cx="10" cy="10" r="6"
          fill="none" stroke="currentColor" stroke-width="1.6"/>
  <line x1="14.5" y1="14.5" x2="20" y2="20"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  <line x1="10" y1="7"  x2="10" y2="13"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  <line x1="7"  y1="10" x2="13" y2="10"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
</svg>"""

# =============================================================================
# WRITE ALL FILES
# =============================================================================

for name, content in ICONS.items():
    path = os.path.join('icons', f'{name}.svg')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'  created  {path}')

print(f'\nDone — {len(ICONS)} icons written to icons/')
