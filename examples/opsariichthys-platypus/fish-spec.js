// fish-spec（ブラウザ簡易版）。書式: .agents/skills/fish-to-3d-aquarium/references/browser-fallback-spec.md
window.FISH_SPECS = [
{
  "id": "opsariichthys-platypus",
  "name_ja": "オイカワ",
  "scientific_name": "Opsariichthys platypus",
  "variant": "婚姻色のオス",
  "length_cm": 13,
  "source": "procedural",
  "status": "draft",
  "seed": 11,
  "notes": "サンプル。写真・三面図を使わず、図鑑的な特徴から手で数値化したもの。追星（頭部の白い突起）は未再現。",
  "traits": [
    "体は細長く側扁する",
    "婚姻色のオスは体側に青緑色の横帯が並ぶ",
    "婚姻色のオスは頬から腹が赤〜橙色になる",
    "オスの臀鰭は大きく、後方へ長く伸びる",
    "尾鰭は二叉形"
  ],
  "body": {
    "end_x": 0.8,
    "top": [
      [
        0,
        0
      ],
      [
        0.03,
        0.025
      ],
      [
        0.08,
        0.05
      ],
      [
        0.16,
        0.075
      ],
      [
        0.3,
        0.09
      ],
      [
        0.42,
        0.088
      ],
      [
        0.55,
        0.07
      ],
      [
        0.68,
        0.045
      ],
      [
        0.76,
        0.032
      ],
      [
        0.8,
        0.03
      ]
    ],
    "bottom": [
      [
        0,
        0
      ],
      [
        0.03,
        -0.02
      ],
      [
        0.1,
        -0.055
      ],
      [
        0.22,
        -0.095
      ],
      [
        0.35,
        -0.11
      ],
      [
        0.48,
        -0.105
      ],
      [
        0.58,
        -0.085
      ],
      [
        0.68,
        -0.05
      ],
      [
        0.76,
        -0.033
      ],
      [
        0.8,
        -0.03
      ]
    ],
    "half_width": [
      [
        0,
        0
      ],
      [
        0.03,
        0.015
      ],
      [
        0.1,
        0.035
      ],
      [
        0.25,
        0.045
      ],
      [
        0.4,
        0.04
      ],
      [
        0.55,
        0.03
      ],
      [
        0.7,
        0.016
      ],
      [
        0.8,
        0.01
      ]
    ],
    "section_exponent": 2.0
  },
  "fins": [
    {
      "type": "dorsal",
      "outline": [
        [
          0.445,
          0.08
        ],
        [
          0.465,
          0.175
        ],
        [
          0.495,
          0.18
        ],
        [
          0.55,
          0.12
        ],
        [
          0.59,
          0.075
        ],
        [
          0.575,
          0.06
        ],
        [
          0.5,
          0.07
        ]
      ],
      "color": "#86a8a2",
      "rays": 9
    },
    {
      "type": "anal",
      "outline": [
        [
          0.555,
          -0.085
        ],
        [
          0.57,
          -0.2
        ],
        [
          0.62,
          -0.215
        ],
        [
          0.72,
          -0.165
        ],
        [
          0.765,
          -0.11
        ],
        [
          0.71,
          -0.045
        ],
        [
          0.62,
          -0.07
        ]
      ],
      "color": "#e8a090",
      "edge_color": "#f4ece0",
      "rays": 11
    },
    {
      "type": "caudal",
      "outline": [
        [
          0.78,
          0.03
        ],
        [
          0.86,
          0.07
        ],
        [
          0.96,
          0.11
        ],
        [
          1.0,
          0.115
        ],
        [
          0.94,
          0.06
        ],
        [
          0.9,
          0.0
        ],
        [
          0.94,
          -0.06
        ],
        [
          1.0,
          -0.115
        ],
        [
          0.96,
          -0.11
        ],
        [
          0.86,
          -0.07
        ],
        [
          0.78,
          -0.03
        ]
      ],
      "color": "#9fb2a6",
      "rays": 18
    },
    {
      "type": "pectoral",
      "base": [
        [
          0.2,
          -0.06
        ],
        [
          0.21,
          -0.078
        ]
      ],
      "outline": [
        [
          0.2,
          -0.06
        ],
        [
          0.21,
          -0.078
        ],
        [
          0.3,
          -0.1
        ],
        [
          0.33,
          -0.088
        ],
        [
          0.28,
          -0.066
        ]
      ],
      "color": "#e07050",
      "opacity": 0.85
    },
    {
      "type": "pelvic",
      "base": [
        [
          0.43,
          -0.103
        ],
        [
          0.45,
          -0.106
        ]
      ],
      "outline": [
        [
          0.43,
          -0.103
        ],
        [
          0.45,
          -0.106
        ],
        [
          0.53,
          -0.128
        ],
        [
          0.54,
          -0.117
        ],
        [
          0.47,
          -0.1
        ]
      ],
      "color": "#e86a48",
      "opacity": 0.9
    }
  ],
  "eye": {
    "x": 0.075,
    "y": 0.02,
    "r": 0.022,
    "iris": "#c8b070"
  },
  "appearance": {
    "base_colors": {
      "dorsal": "#3d5a52",
      "flank": "#86aaa2",
      "ventral": "#eaa898"
    },
    "ventral_start": 0.6,
    "fin_color": "#9fb2a6",
    "fin_opacity": 0.85,
    "metalness": 0.25,
    "iridescence": 0.4,
    "markings": [
      {
        "type": "band",
        "x": 0.25,
        "width": 0.022,
        "r0": 0.15,
        "r1": 0.95,
        "color": "#2b8d9a",
        "opacity": 0.75,
        "blur": 0.003
      },
      {
        "type": "band",
        "x": 0.3,
        "width": 0.022,
        "r0": 0.15,
        "r1": 0.95,
        "color": "#2b8d9a",
        "opacity": 0.75,
        "blur": 0.003
      },
      {
        "type": "band",
        "x": 0.35,
        "width": 0.022,
        "r0": 0.15,
        "r1": 0.95,
        "color": "#2b8d9a",
        "opacity": 0.75,
        "blur": 0.003
      },
      {
        "type": "band",
        "x": 0.4,
        "width": 0.022,
        "r0": 0.15,
        "r1": 0.95,
        "color": "#2b8d9a",
        "opacity": 0.75,
        "blur": 0.003
      },
      {
        "type": "band",
        "x": 0.45,
        "width": 0.022,
        "r0": 0.15,
        "r1": 0.95,
        "color": "#2b8d9a",
        "opacity": 0.75,
        "blur": 0.003
      },
      {
        "type": "band",
        "x": 0.5,
        "width": 0.022,
        "r0": 0.15,
        "r1": 0.95,
        "color": "#2b8d9a",
        "opacity": 0.75,
        "blur": 0.003
      },
      {
        "type": "band",
        "x": 0.55,
        "width": 0.022,
        "r0": 0.15,
        "r1": 0.95,
        "color": "#2b8d9a",
        "opacity": 0.75,
        "blur": 0.003
      },
      {
        "type": "band",
        "x": 0.6,
        "width": 0.02,
        "r0": 0.15,
        "r1": 0.95,
        "color": "#2b8d9a",
        "opacity": 0.7,
        "blur": 0.003
      },
      {
        "type": "band",
        "x": 0.65,
        "width": 0.02,
        "r0": 0.15,
        "r1": 0.95,
        "color": "#2b8d9a",
        "opacity": 0.65,
        "blur": 0.003
      },
      {
        "type": "band",
        "x": 0.7,
        "width": 0.018,
        "r0": 0.15,
        "r1": 0.95,
        "color": "#2b8d9a",
        "opacity": 0.6,
        "blur": 0.003
      },
      {
        "type": "patch",
        "polygon": [
          [
            0.06,
            -0.02
          ],
          [
            0.18,
            -0.035
          ],
          [
            0.4,
            -0.07
          ],
          [
            0.62,
            -0.06
          ],
          [
            0.62,
            -0.13
          ],
          [
            0.06,
            -0.1
          ]
        ],
        "color": "#e8603a",
        "opacity": 0.5,
        "blur": 0.01
      },
      {
        "type": "blotch",
        "x": 0.13,
        "y": -0.03,
        "rx": 0.035,
        "ry": 0.025,
        "color": "#e05a3a",
        "opacity": 0.7,
        "blur": 0.008
      },
      {
        "type": "patch",
        "polygon": [
          [
            0,
            0.01
          ],
          [
            0.1,
            0.065
          ],
          [
            0.16,
            0.05
          ],
          [
            0.1,
            -0.06
          ],
          [
            0,
            -0.01
          ]
        ],
        "color": "#2a3036",
        "opacity": 0.45,
        "blur": 0.01
      }
    ]
  },
  "swim": {
    "style": "subcarangiform",
    "behavior": "school",
    "zone": "mid",
    "schooling": true,
    "speed": 1.1
  }
}
];
