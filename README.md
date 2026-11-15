# Remotion Skia Renderer

**8,858枚を4分57秒で描画（約29.8 fps、メモリ8 GB・12並列）。** 長尺映像「骨粉史」で、Remotionの章タイトルや図表の描画をSkiaへ移したときの実測です。短縮時間を出すには、同じ素材とフレーム範囲での比較が必要です。

## Quick start

Node.js 24で確認済みです。サンプルを6秒分、1920×1080の透過PNG 180枚として出力します。

```sh
npm install
npm run demo -- 4
```

出力先は `frames/demo-4/` です。

## 自分の素材で使う

入力は章ごとのJSONです。`npm run demo -- 4` が作る `props/ch-demo.json` を雛形に、`title`、秒数の `duration`、30 fpsでの `durationInFrames` を指定します。`props/ch01.json` として保存し、`STEP=1` を環境変数に設定して `node render_skia.mjs ch01 4` を実行します。RemotionのJSXを使う場合は描画ロジックの移植が必要です。

[制作事例「骨粉史」](https://www.youtube.com/watch?v=yG7qadPqosU)

## 仕組み

- `render_skia.mjs` が描画対象のフレームを選び、まとまりごとにワーカーへ割り当てます。途中で再実行する場合に備えて既存PNGの検査も行います。
- `skia_renderer.mjs` が章の情報をバッファーへ描画します。フォントや画像は各ワーカーの処理内で再利用します。
- 描画が終わったら、必要なPNGと描画区間のカバレッジを検査します。

## 制作時の計測

| 描画経路 | 対象 | 並列数 | 枚数 | 描画時間 | 描画速度 |
| --- | --- | ---: | ---: | ---: | ---: |
| Remotion / Chromium（ANGLE） | ch04の一部 | 4 | 300 | 26.9秒 | 約11.1 fps |
| Skia | ch00〜ch04の描画対象 | 12 | 8,858 | 297秒 | 約29.8 fps |

制作時のPCはRyzen 9 5900HX、メモリ8 GB。区間と並列数は各計測で異なります。表の速度は生成したPNG枚数を描画時間で割った値です。FFmpegでの合成・エンコードは別工程です。

## デモを動かす

Node.jsとnpmが必要です。Node.js 24と `@napi-rs/canvas` 1.1.0で確認しました。

```sh
npm install
npm run demo -- 4
```

サンプルの章を自動生成し、`frames/demo-4/` に6秒分のPNGを180枚出力します。ワーカー1本でも同じデータを描画できます。

```sh
npm run demo -- 1
```

FFmpegがある場合はMP4にできます。

```sh
ffmpeg -framerate 30 -i frames/demo-4/element-%05d.png -c:v libx264 -pix_fmt yuv420p demo.mp4
```
