// fish-spec（ブラウザ簡易版）。書式: .agents/skills/fish-to-3d-aquarium/references/browser-fallback-spec.md
window.FISH_SPECS = [
{
  "id": "misgurnus-anguillicaudatus",
  "name_ja": "ドジョウ",
  "scientific_name": "Misgurnus anguillicaudatus",
  "variant": null,
  "length_cm": 12,
  "source": "procedural",
  "status": "draft",
  "seed": 23,
  "notes": "サンプル。写真・三面図を使わず、図鑑的な特徴から手で数値化したもの。",
  "traits": [
    "口ひげは5対（10本）",
    "体は細長い円筒形で、後半は側扁する",
    "尾鰭は丸い",
    "尾鰭の付け根の上部に小さな黒斑",
    "体側に細かい暗色の斑点"
  ],
  "body": {
    "end_x": 0.87,
    "top": [
      [
        0,
        0
      ],
      [
        0.03,
        0.02
      ],
      [
        0.08,
        0.035
      ],
      [
        0.2,
        0.05
      ],
      [
        0.4,
        0.055
      ],
      [
        0.6,
        0.055
      ],
      [
        0.75,
        0.05
      ],
      [
        0.84,
        0.04
      ],
      [
        0.87,
        0.038
      ]
    ],
    "bottom": [
      [
        0,
        -0.005
      ],
      [
        0.03,
        -0.02
      ],
      [
        0.08,
        -0.035
      ],
      [
        0.2,
        -0.05
      ],
      [
        0.4,
        -0.055
      ],
      [
        0.6,
        -0.05
      ],
      [
        0.75,
        -0.04
      ],
      [
        0.84,
        -0.035
      ],
      [
        0.87,
        -0.034
      ]
    ],
    "half_width": [
      [
        0,
        0
      ],
      [
        0.04,
        0.022
      ],
      [
        0.15,
        0.045
      ],
      [
        0.4,
        0.045
      ],
      [
        0.6,
        0.034
      ],
      [
        0.75,
        0.022
      ],
      [
        0.87,
        0.012
      ]
    ],
    "section_exponent": [
      [
        0,
        2.0
      ],
      [
        0.4,
        2.1
      ],
      [
        0.87,
        2.0
      ]
    ]
  },
  "fins": [
    {
      "type": "dorsal",
      "outline": [
        [
          0.48,
          0.05
        ],
        [
          0.5,
          0.1
        ],
        [
          0.54,
          0.102
        ],
        [
          0.575,
          0.06
        ],
        [
          0.565,
          0.048
        ]
      ],
      "color": "#b0a080",
      "rays": 8
    },
    {
      "type": "anal",
      "outline": [
        [
          0.66,
          -0.042
        ],
        [
          0.68,
          -0.08
        ],
        [
          0.72,
          -0.082
        ],
        [
          0.745,
          -0.042
        ]
      ],
      "color": "#b8a888",
      "rays": 7
    },
    {
      "type": "caudal",
      "outline": [
        [
          0.85,
          0.036
        ],
        [
          0.91,
          0.062
        ],
        [
          0.97,
          0.062
        ],
        [
          1.0,
          0.03
        ],
        [
          1.0,
          -0.025
        ],
        [
          0.97,
          -0.058
        ],
        [
          0.91,
          -0.058
        ],
        [
          0.85,
          -0.033
        ]
      ],
      "color": "#a89878",
      "rays": 14,
      "markings": [
        {
          "type": "spots",
          "x0": 0.88,
          "x1": 0.99,
          "r0": -0.6,
          "r1": 1.6,
          "count": 28,
          "radius": 0.004,
          "color": "#4a3e28",
          "opacity": 0.8
        }
      ]
    },
    {
      "type": "pectoral",
      "base": [
        [
          0.17,
          -0.035
        ],
        [
          0.18,
          -0.046
        ]
      ],
      "outline": [
        [
          0.17,
          -0.035
        ],
        [
          0.18,
          -0.047
        ],
        [
          0.24,
          -0.062
        ],
        [
          0.25,
          -0.05
        ]
      ],
      "color": "#c0b090",
      "opacity": 0.8,
      "spread_deg": 45
    },
    {
      "type": "pelvic",
      "base": [
        [
          0.5,
          -0.05
        ],
        [
          0.52,
          -0.052
        ]
      ],
      "outline": [
        [
          0.5,
          -0.05
        ],
        [
          0.52,
          -0.053
        ],
        [
          0.57,
          -0.066
        ],
        [
          0.575,
          -0.055
        ]
      ],
      "color": "#c0b090",
      "opacity": 0.8
    }
  ],
  "barbels": [
    {
      "x": 0.012,
      "y": -0.008,
      "length": 0.03,
      "angle_deg": 30,
      "spread_deg": 25
    },
    {
      "x": 0.018,
      "y": -0.012,
      "length": 0.04,
      "angle_deg": 55,
      "spread_deg": 30
    },
    {
      "x": 0.024,
      "y": -0.015,
      "length": 0.045,
      "angle_deg": 75,
      "spread_deg": 35
    },
    {
      "x": 0.03,
      "y": -0.016,
      "length": 0.03,
      "angle_deg": 100,
      "spread_deg": 25
    },
    {
      "x": 0.035,
      "y": -0.017,
      "length": 0.025,
      "angle_deg": 120,
      "spread_deg": 15
    }
  ],
  "eye": {
    "x": 0.05,
    "y": 0.02,
    "r": 0.009,
    "iris": "#b89a60",
    "inset": 0.3
  },
  "appearance": {
    "base_colors": {
      "dorsal": "#5e5438",
      "flank": "#a08e66",
      "ventral": "#ddd2b8"
    },
    "ventral_start": 0.62,
    "fin_color": "#b0a080",
    "roughness": 0.5,
    "clearcoat": 0.8,
    "markings": [
      {
        "type": "spots",
        "x0": 0.04,
        "x1": 0.86,
        "r0": 0.3,
        "r1": 1.0,
        "count": 220,
        "radius": 0.0035,
        "radius_jitter": 0.8,
        "color": "#3e3420",
        "opacity": 0.75,
        "seed": 5
      },
      {
        "type": "spots",
        "x0": 0.1,
        "x1": 0.86,
        "r0": 0.35,
        "r1": 0.75,
        "count": 26,
        "radius": 0.008,
        "aspect": 1.6,
        "color": "#4a3e26",
        "opacity": 0.5,
        "blur": 0.003,
        "seed": 9
      },
      {
        "type": "blotch",
        "x": 0.865,
        "r": 0.82,
        "radius": 0.008,
        "color": "#1a1610",
        "opacity": 0.95
      }
    ]
  },
  "swim": {
    "style": "anguilliform",
    "behavior": "bottom",
    "zone": "bottom",
    "speed": 0.6
  }
}
];
