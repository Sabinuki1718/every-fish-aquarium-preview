#!/usr/bin/env node
// three.js と追加機能を1ファイルにまとめる（開発者向け。スキルの利用者は実行しなくてよい）。
//   cd dev && npm install && npm run build
// 出力（通常の <script> で読める・通信不要）:
//   .agents/skills/fish-to-3d-aquarium/assets/three-offline.js  window.THREE（水槽の通信不要版に埋め込む）

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const DEV = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(DEV, '..', '.agents/skills/fish-to-3d-aquarium/assets');
const targets = [
  ['src/three-offline.js', 'three-offline.js', 'three.js r170 と追加機能（window.THREE）'],
];
for (const [src, name, label] of targets) {
  const outfile = path.join(ASSETS, name);
  await esbuild.build({
    entryPoints: [path.join(DEV, src)],
    bundle: true, format: 'iife', minify: true, target: 'es2020', legalComments: 'eof',
    outfile,
    banner: { js: `/* fish-to-3d-aquarium: ${label}。ソース: dev/${src}（three.js MIT License を同梱） */` },
  });
  console.log(`書き出しました: ${path.relative(process.cwd(), outfile)}`);
}
