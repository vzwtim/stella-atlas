# Stella Atlas — 星図儀 設計書

## 目的
天文学的に正確なデータに基づくスムーズな3D星空体験。Vite + TypeScript + Three.js。

## データ
- **恒星**: HYGデータベースから視等級 ≤ 6.5 の約9,000星（赤経・赤緯・距離・等級・B-V色指数・スペクトル型）。`scripts/fetch-data.mjs` がビルド前に取得・変換し `public/data/stars.json` を生成
- **星座線**: Stellarium の星座線定義（HIP番号ペア、全88星座）→ `public/data/constellations.json`
- **日本語名**: 88星座の和名と主要恒星の和名は埋め込み辞書

## 体験
1. **天球モード**: 中心視点。カスタムシェーダのポイントスプライト（等級→サイズ/輝度、B-V→色温度）。星座線は淡い発光ライン、ホバーでハイライト+和名ラベル
2. **没入フライト**: 星クリック→実距離（対数スケール）の3D位置へイージング飛行。接近時は恒星表面シェーダ（ノイズ粒状斑+温度色）+コロナ。日本語情報パネル
3. **銀河背景**: 銀河面に沿った約10万パーティクルの天の川 + 星雲ヘイズ

## UI（日本語）
星座検索、日周運動（自転シミュレート）トグル、操作ガイド、グラスモーフィズム系ダークUI

## 技術
- Three.js + UnrealBloomPass（bloom）
- レイキャストによる星ピッキング
- モジュール: scene / stars / constellations / galaxy / flight / ui / astro

## デプロイ
GitHub → Vercel（静的ビルド、`npm run build` → `dist/`）
